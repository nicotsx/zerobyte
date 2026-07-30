import waitForExpect from "wait-for-expect";
import { afterEach, describe, expect, test, vi } from "vitest";
import { backupsService } from "../backups.service";
import { createTestVolume } from "~/test/helpers/volume";
import { createTestBackupSchedule } from "~/test/helpers/backup";
import { createTestRepository } from "~/test/helpers/repository";
import { generateBackupOutput } from "~/test/helpers/restic";
import { TEST_ORG_ID } from "~/test/helpers/organization";
import * as context from "~/server/core/request-context";
import * as spawnModule from "@zerobyte/core/node";
import type { SafeSpawnParams } from "@zerobyte/core/node";
import { logger } from "@zerobyte/core/node";
import { restic } from "~/server/core/restic";
import { NotFoundError } from "http-errors-enhanced";
import { fromAny } from "@total-typescript/shoehorn";
import { scheduleQueries } from "../backups.queries";
import { repositoriesService } from "~/server/modules/repositories/repositories.service";
import { repoMutex } from "~/server/core/repository-mutex";
import { notificationsService } from "~/server/modules/notifications/notifications.service";
import { agentManager } from "~/server/modules/agents/agents-manager";
import { createAgentBackupMocks } from "~/test/helpers/agent-mock";
import { getScheduleByIdOrShortId } from "../helpers/backup-schedule-lookups";
import { volumeService } from "~/server/modules/volumes/volume.service";
import { db } from "~/server/db/db";
import { config } from "~/server/core/config";
import { Effect } from "effect";
import { taskStore } from "~/server/modules/tasks/tasks.store";
import { requestTaskCancel } from "~/server/modules/tasks/tasks.lifecycle";
import { serverEvents } from "~/server/core/events";
import { backupSchedulesTable } from "~/server/db/schema";
import { eq } from "drizzle-orm";
import type { ServerEventPayloadMap } from "~/schemas/server-events";

const eventListenerCleanups: Array<() => void> = [];

const setup = () => {
	const resticBackupMock = vi.fn((_: SafeSpawnParams) =>
		Promise.resolve({ exitCode: 0, summary: generateBackupOutput(), error: "" }),
	);
	const resticForgetMock = vi.fn(() => Effect.succeed({ success: true, data: null }));
	const { runBackupMock, cancelBackupMock } = createAgentBackupMocks(resticBackupMock);
	const refreshStatsMock = vi.fn(() =>
		Promise.resolve({
			total_size: 0,
			total_uncompressed_size: 0,
			compression_ratio: 0,
			compression_progress: 0,
			compression_space_saving: 0,
			snapshots_count: 0,
		}),
	);

	vi.spyOn(spawnModule, "safeSpawn").mockImplementation(resticBackupMock);
	vi.spyOn(restic, "forget").mockImplementation(resticForgetMock);
	vi.spyOn(repositoriesService, "refreshRepositoryStats").mockImplementation(refreshStatsMock);
	vi.spyOn(agentManager, "runBackup").mockImplementation(runBackupMock);
	vi.spyOn(agentManager, "cancelBackup").mockImplementation(cancelBackupMock);
	vi.spyOn(context, "getOrganizationId").mockReturnValue(TEST_ORG_ID);
	const ensureHealthyVolumeMock = vi
		.spyOn(volumeService, "ensureHealthyVolume")
		.mockImplementation(async (shortId) => {
			const volume = await db.query.volumesTable.findFirst({
				where: {
					AND: [{ shortId: { eq: shortId } }, { organizationId: TEST_ORG_ID }],
				},
			});

			if (!volume) {
				throw new NotFoundError("Volume not found");
			}

			if (volume.status !== "mounted") {
				return {
					ready: false as const,
					volume,
					reason: "Volume is not mounted",
				};
			}

			return {
				ready: true as const,
				volume,
				remounted: false,
			};
		});

	return {
		resticBackupMock,
		resticForgetMock,
		runBackupMock,
		cancelBackupMock,
		refreshStatsMock,
		ensureHealthyVolumeMock,
	};
};

const getBackupTaskForSchedule = async (scheduleId: number) => {
	const schedule = await getScheduleByIdOrShortId(scheduleId);
	return db.query.tasksTable.findFirst({
		where: {
			AND: [
				{ organizationId: TEST_ORG_ID },
				{ kind: "backup" },
				{ resourceType: "backup_schedule" },
				{ resourceId: schedule.shortId },
			],
		},
	});
};

const waitForBackupTaskStatus = async (scheduleId: number, status: "succeeded" | "failed" | "cancelled") => {
	await waitForExpect(async () => {
		const task = await getBackupTaskForSchedule(scheduleId);
		expect(task?.status).toBe(status);
	});
};

const observeScheduleStatusAtTaskOutcome = (scheduleId: number, outcome: "error" | "cancelled") => {
	const statuses: Array<string | null> = [];
	const recordStatus = (event: ServerEventPayloadMap["task:history-changed"]) => {
		if (event.item.kind !== "backup" || event.item.outcome !== outcome) {
			return;
		}

		const persistedSchedule = db
			.select({ lastBackupStatus: backupSchedulesTable.lastBackupStatus })
			.from(backupSchedulesTable)
			.where(eq(backupSchedulesTable.id, scheduleId))
			.get();
		statuses.push(persistedSchedule?.lastBackupStatus ?? null);
	};

	serverEvents.on("task:history-changed", recordStatus);
	eventListenerCleanups.push(() => serverEvents.off("task:history-changed", recordStatus));

	return statuses;
};

afterEach(() => {
	for (const cleanup of eventListenerCleanups.splice(0)) {
		cleanup();
	}
	vi.restoreAllMocks();
	config.flags.enableLocalAgent = true;
});

describe("backup execution - validation failures", () => {
	test("does not fail validation when the agent runtime owns volume readiness", async () => {
		// arrange
		const { resticBackupMock } = setup();
		const volume = await createTestVolume({ status: "unmounted" });
		const repository = await createTestRepository();
		const schedule = await createTestBackupSchedule({
			volumeId: volume.id,
			repositoryId: repository.id,
		});

		// act
		const result = await backupsService.validateBackupExecution(schedule.id);

		// assert
		expect(result.type).toBe("success");
		expect(resticBackupMock).not.toHaveBeenCalled();
	});

	test("should fail backup when volume does not exist", async () => {
		// arrange
		setup();
		const volume = await createTestVolume();
		const repository = await createTestRepository();
		const schedule = await createTestBackupSchedule({
			volumeId: volume.id,
			repositoryId: repository.id,
		});

		const hydratedSchedule = await scheduleQueries.findById(schedule.id, TEST_ORG_ID);
		expect(hydratedSchedule).toBeDefined();
		const scheduleWithoutVolume = {
			...hydratedSchedule,
			volume: null,
		};
		vi.spyOn(scheduleQueries, "findById").mockResolvedValueOnce(fromAny(scheduleWithoutVolume));

		// act
		const result = await backupsService.validateBackupExecution(schedule.id);

		// assert
		expect(result.type).toBe("failure");
		if (result.type === "failure") {
			expect(result.error).toBeInstanceOf(NotFoundError);
			expect(result.error.message).toBe("Volume not found");
			expect(result.partialContext?.schedule).toBeDefined();
		}
	});

	test("should fail backup when repository does not exist", async () => {
		// arrange
		setup();
		const volume = await createTestVolume();
		const repository = await createTestRepository();
		const schedule = await createTestBackupSchedule({
			volumeId: volume.id,
			repositoryId: repository.id,
		});

		const hydratedSchedule = await scheduleQueries.findById(schedule.id, TEST_ORG_ID);
		expect(hydratedSchedule).toBeDefined();
		const scheduleWithoutRepository = {
			...hydratedSchedule,
			repository: null,
		};
		vi.spyOn(scheduleQueries, "findById").mockResolvedValueOnce(fromAny(scheduleWithoutRepository));

		// act
		const result = await backupsService.validateBackupExecution(schedule.id);

		// assert
		expect(result.type).toBe("failure");
		if (result.type === "failure") {
			expect(result.error).toBeInstanceOf(NotFoundError);
			expect(result.error.message).toBe("Repository not found");
			expect(result.partialContext?.schedule).toBeDefined();
			expect(result.partialContext?.volume).toBeDefined();
		}
	});
	test("should fail backup when schedule does not exist", async () => {
		setup();
		// act
		const result = await backupsService.validateBackupExecution(99999);

		// assert
		expect(result.type).toBe("failure");
		if (result.type === "failure") {
			expect(result.error).toBeInstanceOf(NotFoundError);
			expect(result.error.message).toBe("Backup schedule not found");
		}
	});

	test("does not claim retries when none were scheduled", async () => {
		const { resticBackupMock } = setup();
		const notificationSpy = vi.spyOn(notificationsService, "sendBackupNotification").mockResolvedValue();
		const volume = await createTestVolume();
		const repository = await createTestRepository();
		const schedule = await createTestBackupSchedule({
			volumeId: volume.id,
			repositoryId: repository.id,
			cronExpression: "* * * * *",
			maxRetries: 2,
			retryDelay: 15 * 60 * 1000,
		});

		resticBackupMock.mockImplementationOnce(() =>
			Promise.resolve({ exitCode: 1, summary: generateBackupOutput(), error: "failed" }),
		);

		await backupsService.executeBackup(schedule.id);

		await waitForExpect(() => {
			expect(notificationSpy).toHaveBeenCalled();
			expect(notificationSpy.mock.calls.at(-1)?.[2]?.error).toBe("failed");
		});
	});

	test("does not log an invalid cron error for manual-only failures", async () => {
		const { resticBackupMock } = setup();
		const errorSpy = vi.spyOn(logger, "error").mockImplementation(() => {});
		const volume = await createTestVolume();
		const repository = await createTestRepository();
		const schedule = await createTestBackupSchedule({
			volumeId: volume.id,
			repositoryId: repository.id,
			enabled: false,
			cronExpression: "",
		});

		resticBackupMock.mockImplementationOnce(() =>
			Promise.resolve({ exitCode: 1, summary: generateBackupOutput(), error: "manual failure" }),
		);

		await backupsService.executeBackup(schedule.id, true);

		expect(
			errorSpy.mock.calls.some(([message]) => String(message).includes('Failed to parse cron expression ""')),
		).toBe(false);
	});

	test("creates a backup task and uses the task id as the agent job id", async () => {
		const { runBackupMock } = setup();
		const volume = await createTestVolume();
		const repository = await createTestRepository();
		const schedule = await createTestBackupSchedule({
			volumeId: volume.id,
			repositoryId: repository.id,
		});

		await backupsService.executeBackup(schedule.id);
		await waitForBackupTaskStatus(schedule.id, "succeeded");

		const task = await getBackupTaskForSchedule(schedule.id);
		expect(task).toBeDefined();
		expect(task).toMatchObject({
			organizationId: TEST_ORG_ID,
			kind: "backup",
			status: "succeeded",
			resourceType: "backup_schedule",
			resourceId: schedule.shortId,
			targetAgentId: "local",
			input: {
				kind: "backup",
				scheduleId: schedule.id,
				scheduleShortId: schedule.shortId,
				manual: false,
			},
			result: expect.objectContaining({
				kind: "backup",
				exitCode: 0,
				warningDetails: null,
			}),
		});
		expect(runBackupMock.mock.calls[0]?.[1].payload.jobId).toBe(task!.id);
	});

	test("rejects a concurrent backup start for the same schedule", async () => {
		const { resticBackupMock } = setup();
		const volume = await createTestVolume();
		const repository = await createTestRepository();
		const schedule = await createTestBackupSchedule({
			volumeId: volume.id,
			repositoryId: repository.id,
		});
		let finishBackup: (() => void) | undefined;
		const backupStarted = new Promise<void>((resolve) => {
			resticBackupMock.mockImplementationOnce(
				() =>
					new Promise((resolveBackup) => {
						finishBackup = () => {
							resolveBackup({ exitCode: 0, summary: generateBackupOutput(), error: "" });
						};
						resolve();
					}),
			);
		});

		const firstStart = await backupsService.executeBackup(schedule.id, true);
		expect(firstStart).toMatchObject({ taskId: expect.any(String), status: "started" });
		await backupStarted;

		await expect(backupsService.executeBackup(schedule.id, true)).rejects.toThrow(
			"Backup is already running for this schedule",
		);

		if (!finishBackup) {
			throw new Error("Expected the first backup to start");
		}
		finishBackup();

		await waitForExpect(async () => {
			const task = await getBackupTaskForSchedule(schedule.id);
			expect(task?.status).toBe("succeeded");
		});
	});

	test("records a failed task when backup startup state fails", async () => {
		const { runBackupMock } = setup();
		const volume = await createTestVolume();
		const repository = await createTestRepository();
		const schedule = await createTestBackupSchedule({
			volumeId: volume.id,
			repositoryId: repository.id,
		});

		vi.spyOn(scheduleQueries, "updateStatus").mockRejectedValueOnce(new Error("status update failed"));

		const backupStart = await backupsService.executeBackup(schedule.id);
		expect(backupStart).toMatchObject({ taskId: expect.any(String), status: "started" });
		await waitForBackupTaskStatus(schedule.id, "failed");

		expect((await getBackupTaskForSchedule(schedule.id))?.error).toBe("status update failed");
		expect(runBackupMock).not.toHaveBeenCalled();
	});

	test("persists latest backup progress while preserving execution", async () => {
		const { runBackupMock } = setup();
		const updateProgressSpy = vi.spyOn(taskStore, "updateProgress");
		const volume = await createTestVolume();
		const repository = await createTestRepository();
		const schedule = await createTestBackupSchedule({
			volumeId: volume.id,
			repositoryId: repository.id,
		});

		runBackupMock.mockImplementationOnce(async (_agentId, request) => {
			request.onProgress({
				message_type: "status",
				seconds_elapsed: 1,
				seconds_remaining: 9,
				percent_done: 0.25,
				total_files: 100,
				files_done: 25,
				total_bytes: 1000,
				bytes_done: 250,
				current_files: ["file.txt"],
			});
			request.onProgress({
				message_type: "status",
				seconds_elapsed: 2,
				seconds_remaining: 8,
				percent_done: 0.5,
				total_files: 100,
				files_done: 50,
				total_bytes: 1000,
				bytes_done: 500,
				current_files: ["later.txt"],
			});

			return {
				status: "completed",
				exitCode: 0,
				result: JSON.parse(generateBackupOutput()),
				warningDetails: null,
			};
		});

		await backupsService.executeBackup(schedule.id);
		await waitForBackupTaskStatus(schedule.id, "succeeded");

		const task = await getBackupTaskForSchedule(schedule.id);
		expect(task?.status).toBe("succeeded");
		expect(updateProgressSpy).toHaveBeenCalledTimes(2);
		expect(updateProgressSpy.mock.calls[0]?.[1]).toMatchObject({
			kind: "backup",
			progress: {
				percent_done: 0.25,
				bytes_done: 250,
				current_files: ["file.txt"],
			},
		});
		expect(updateProgressSpy.mock.calls[1]?.[1]).toMatchObject({
			kind: "backup",
			progress: {
				percent_done: 0.5,
				bytes_done: 500,
				current_files: ["later.txt"],
			},
		});
		expect(task?.progress).toMatchObject({
			kind: "backup",
			progress: {
				percent_done: 0.5,
				bytes_done: 500,
				current_files: ["later.txt"],
			},
		});
	});

	test("passes configured backup webhooks to the backup agent", async () => {
		const { runBackupMock } = setup();
		const volume = await createTestVolume();
		const repository = await createTestRepository();
		const backupWebhooks = {
			pre: {
				url: "http://localhost:8080/stop",
				headers: ["authorization: Bearer stop-token"],
				body: '{"action":"stop"}',
				insecureTls: true,
			},
			post: {
				url: "http://localhost:8080/start",
				headers: ["authorization: Bearer start-token"],
				body: '{"action":"start"}',
				insecureTls: true,
			},
		};

		const schedule = await createTestBackupSchedule({
			volumeId: volume.id,
			repositoryId: repository.id,
			backupWebhooks,
		});

		await backupsService.executeBackup(schedule.id);

		await waitForExpect(() => {
			expect(runBackupMock).toHaveBeenCalledWith(
				"local",
				expect.objectContaining({
					payload: expect.objectContaining({
						webhooks: backupWebhooks,
					}),
				}),
			);
		});
	});

	test("adds ignore-inode by default for FUSE-backed volumes", async () => {
		const { runBackupMock } = setup();
		const volume = await createTestVolume({
			type: "sftp",
			config: {
				backend: "sftp",
				host: "storage.example.com",
				port: 22,
				username: "backup",
				privateKey: "key",
				path: "/data",
				skipHostKeyCheck: false,
				allowLegacySshRsa: false,
				allowUnsafeSymlinkTargets: false,
			},
		});
		const repository = await createTestRepository();
		const schedule = await createTestBackupSchedule({
			volumeId: volume.id,
			repositoryId: repository.id,
		});

		await backupsService.executeBackup(schedule.id);

		await waitForExpect(() => {
			expect(runBackupMock).toHaveBeenCalledWith(
				"local",
				expect.objectContaining({
					payload: expect.objectContaining({
						options: expect.objectContaining({
							customResticParams: ["--ignore-inode"],
						}),
					}),
				}),
			);
		});
	});

	test("does not add ignore-inode by default for directory volumes", async () => {
		const { runBackupMock } = setup();
		const volume = await createTestVolume();
		const repository = await createTestRepository();
		const schedule = await createTestBackupSchedule({
			volumeId: volume.id,
			repositoryId: repository.id,
		});

		await backupsService.executeBackup(schedule.id);

		await waitForExpect(() => {
			expect(runBackupMock).toHaveBeenCalledWith(
				"local",
				expect.objectContaining({
					payload: expect.objectContaining({
						options: expect.objectContaining({
							customResticParams: [],
						}),
					}),
				}),
			);
		});
	});

	test("does not duplicate ignore-inode when already configured", async () => {
		const { runBackupMock } = setup();
		const volume = await createTestVolume({
			type: "rclone",
			config: {
				backend: "rclone",
				remote: "remote",
				path: "/data",
			},
		});
		const repository = await createTestRepository();
		const schedule = await createTestBackupSchedule({
			volumeId: volume.id,
			repositoryId: repository.id,
			customResticParams: ["--ignore-inode"],
		});

		await backupsService.executeBackup(schedule.id);

		await waitForExpect(() => {
			expect(runBackupMock).toHaveBeenCalledWith(
				"local",
				expect.objectContaining({
					payload: expect.objectContaining({
						options: expect.objectContaining({
							customResticParams: ["--ignore-inode"],
						}),
					}),
				}),
			);
		});
	});

	test("uses the job compression mode override over the repository default", async () => {
		const { runBackupMock } = setup();
		const volume = await createTestVolume();
		const repository = await createTestRepository({ compressionMode: "max" });
		const schedule = await createTestBackupSchedule({
			volumeId: volume.id,
			repositoryId: repository.id,
			compressionMode: "off",
		});

		await backupsService.executeBackup(schedule.id);
		await waitForBackupTaskStatus(schedule.id, "succeeded");

		expect(runBackupMock).toHaveBeenCalledWith(
			"local",
			expect.objectContaining({
				payload: expect.objectContaining({
					options: expect.objectContaining({
						compressionMode: "off",
					}),
				}),
			}),
		);
	});

	test("inherits the repository compression mode when the job has no override", async () => {
		const { runBackupMock } = setup();
		const volume = await createTestVolume();
		const repository = await createTestRepository({ compressionMode: "max" });
		const schedule = await createTestBackupSchedule({
			volumeId: volume.id,
			repositoryId: repository.id,
			compressionMode: null,
		});

		await backupsService.executeBackup(schedule.id);
		await waitForBackupTaskStatus(schedule.id, "succeeded");

		expect(runBackupMock).toHaveBeenCalledWith(
			"local",
			expect.objectContaining({
				payload: expect.objectContaining({
					options: expect.objectContaining({
						compressionMode: "max",
					}),
				}),
			}),
		);
	});

	test("falls back to auto when neither the job nor the repository define a compression mode", async () => {
		const { runBackupMock } = setup();
		const volume = await createTestVolume();
		const repository = await createTestRepository({ compressionMode: null });
		const schedule = await createTestBackupSchedule({
			volumeId: volume.id,
			repositoryId: repository.id,
			compressionMode: null,
		});

		await backupsService.executeBackup(schedule.id);
		await waitForBackupTaskStatus(schedule.id, "succeeded");

		expect(runBackupMock).toHaveBeenCalledWith(
			"local",
			expect.objectContaining({
				payload: expect.objectContaining({
					options: expect.objectContaining({
						compressionMode: "auto",
					}),
				}),
			}),
		);
	});

	test("passes the job compression override to the restic command on the local no-agent path", async () => {
		const { resticBackupMock, runBackupMock } = setup();
		config.flags.enableLocalAgent = false;
		const volume = await createTestVolume();
		const repository = await createTestRepository({ compressionMode: "max" });
		const schedule = await createTestBackupSchedule({
			volumeId: volume.id,
			repositoryId: repository.id,
			compressionMode: "off",
		});

		runBackupMock.mockResolvedValueOnce({
			status: "unavailable",
			error: new Error("Local backup agent is not connected"),
		});

		await backupsService.executeBackup(schedule.id);
		await waitForBackupTaskStatus(schedule.id, "succeeded");

		expect(resticBackupMock).toHaveBeenCalled();
		const args = resticBackupMock.mock.calls[0][0].args;
		const compressionIdx = args.indexOf("--compression");
		expect(compressionIdx).toBeGreaterThan(-1);
		expect(args[compressionIdx + 1]).toBe("off");
	});

	test("should fail backup when the local agent is unavailable", async () => {
		const { runBackupMock } = setup();
		const volume = await createTestVolume();
		const repository = await createTestRepository();
		const schedule = await createTestBackupSchedule({
			volumeId: volume.id,
			repositoryId: repository.id,
		});

		runBackupMock.mockResolvedValueOnce({
			status: "unavailable",
			error: new Error("Local backup agent is not connected"),
		});

		await backupsService.executeBackup(schedule.id);
		await waitForBackupTaskStatus(schedule.id, "failed");

		const updatedSchedule = await getScheduleByIdOrShortId(schedule.id);
		const task = await getBackupTaskForSchedule(schedule.id);
		expect(updatedSchedule.lastBackupStatus).toBe("error");
		expect(updatedSchedule.lastBackupError).toBe("Local backup agent is not connected");
		expect(task?.status).toBe("failed");
		expect(task?.error).toBe("Local backup agent is not connected");
	});

	test("persists the failed schedule before emitting the terminal task event", async () => {
		const { runBackupMock } = setup();
		const volume = await createTestVolume();
		const repository = await createTestRepository();
		const schedule = await createTestBackupSchedule({
			volumeId: volume.id,
			repositoryId: repository.id,
		});
		const statusesAtTerminalEvent = observeScheduleStatusAtTaskOutcome(schedule.id, "error");
		runBackupMock.mockResolvedValueOnce({
			status: "unavailable",
			error: new Error("Local backup agent is not connected"),
		});

		await backupsService.executeBackup(schedule.id);
		await waitForBackupTaskStatus(schedule.id, "failed");

		expect(statusesAtTerminalEvent).toEqual(["error"]);
	});

	test("removes stale locks and retries once when the local backup fallback hits a restic lock", async () => {
		const { resticBackupMock, runBackupMock } = setup();
		config.flags.enableLocalAgent = false;
		const safeExecMock = vi.spyOn(spawnModule, "safeExec").mockResolvedValue({
			exitCode: 0,
			stdout: "",
			stderr: "",
			timedOut: false,
		});
		const volume = await createTestVolume();
		const repository = await createTestRepository();
		const schedule = await createTestBackupSchedule({
			volumeId: volume.id,
			repositoryId: repository.id,
		});

		runBackupMock.mockResolvedValueOnce({
			status: "unavailable",
			error: new Error("Local backup agent is not connected"),
		});
		resticBackupMock
			.mockImplementationOnce((params: SafeSpawnParams) => {
				params.onStderr?.("unable to create lock in backend: repository is already locked");
				return Promise.resolve({
					exitCode: 11,
					summary: "",
					error: "unable to create lock in backend: repository is already locked",
				});
			})
			.mockImplementationOnce(() => Promise.resolve({ exitCode: 0, summary: generateBackupOutput(), error: "" }));

		await backupsService.executeBackup(schedule.id);
		await waitForBackupTaskStatus(schedule.id, "succeeded");

		const updatedSchedule = await getScheduleByIdOrShortId(schedule.id);
		expect(updatedSchedule.lastBackupStatus).toBe("success");
		expect(resticBackupMock).toHaveBeenCalledTimes(2);
		const unlockCalls = safeExecMock.mock.calls.filter(([params]) => params.args?.includes("unlock"));
		expect(unlockCalls).toHaveLength(1);
		expect(unlockCalls[0]?.[0].args).not.toContain("--remove-all");
	});
});

describe("backup execution - routing", () => {
	test("fails local repository backups on non-local volume agents", async () => {
		const { runBackupMock } = setup();
		const volume = await createTestVolume({ agentId: "agent-remote" });
		const repository = await createTestRepository();
		const schedule = await createTestBackupSchedule({
			volumeId: volume.id,
			repositoryId: repository.id,
		});

		await backupsService.executeBackup(schedule.id);
		await waitForBackupTaskStatus(schedule.id, "failed");

		const updatedSchedule = await getScheduleByIdOrShortId(schedule.id);
		expect(updatedSchedule.lastBackupStatus).toBe("error");
		expect(updatedSchedule.lastBackupError).toBe(
			`Local repository "${repository.name}" can only be used with the local agent`,
		);
		expect(runBackupMock).not.toHaveBeenCalled();
	});

	test("routes remote repository backups through the owning volume agent", async () => {
		const { runBackupMock } = setup();
		const volume = await createTestVolume({ agentId: "agent-remote" });
		const repository = await createTestRepository({
			type: "s3",
			config: {
				backend: "s3",
				endpoint: "https://s3.amazonaws.com",
				bucket: "bucket-name",
				accessKeyId: "access-key",
				secretAccessKey: "secret-key",
			},
		});
		const schedule = await createTestBackupSchedule({
			volumeId: volume.id,
			repositoryId: repository.id,
		});

		await backupsService.executeBackup(schedule.id);

		await waitForExpect(() => {
			expect(runBackupMock).toHaveBeenCalledWith(
				"agent-remote",
				expect.objectContaining({ scheduleId: schedule.id }),
			);
		});
	});
});

describe("backup cancellation", () => {
	test("cancels a running backup through the task execution registry", async () => {
		const { resticBackupMock, runBackupMock } = setup();
		const volume = await createTestVolume();
		const repository = await createTestRepository();
		const schedule = await createTestBackupSchedule({
			volumeId: volume.id,
			repositoryId: repository.id,
		});
		const statusesAtTerminalEvent = observeScheduleStatusAtTaskOutcome(schedule.id, "cancelled");

		resticBackupMock.mockImplementation(
			({ signal }: SafeSpawnParams) =>
				new Promise((resolve) => {
					signal?.addEventListener("abort", () => resolve({ exitCode: 1, summary: "", error: "" }), {
						once: true,
					});
				}),
		);

		const executePromise = backupsService.executeBackup(schedule.id);
		let runningTaskId: string | undefined;
		await waitForExpect(async () => {
			const runningTask = await getBackupTaskForSchedule(schedule.id);
			expect(runningTask?.status).toBe("running");
			expect(runBackupMock).toHaveBeenCalledTimes(1);
			runningTaskId = runningTask?.id;
		});

		expect(runningTaskId).toBeDefined();
		if (!runningTaskId) {
			throw new Error("Expected a running backup task");
		}

		expect(requestTaskCancel(runningTaskId)).toBe(true);
		await executePromise;
		await waitForBackupTaskStatus(schedule.id, "cancelled");

		const cancelledTask = await getBackupTaskForSchedule(schedule.id);
		const updatedSchedule = await getScheduleByIdOrShortId(schedule.id);
		expect(cancelledTask?.status).toBe("cancelled");
		expect(cancelledTask?.cancellationRequested).toBe(true);
		expect(updatedSchedule.lastBackupStatus).toBe("warning");
		expect(updatedSchedule.lastBackupError).toBe("Task was cancelled by the user");
		expect(statusesAtTerminalEvent).toEqual(["warning"]);
	});

	test("should keep restic warning details when backup completes with read errors", async () => {
		const { resticBackupMock } = setup();
		const notificationSpy = vi.spyOn(notificationsService, "sendBackupNotification").mockResolvedValue();
		const volume = await createTestVolume();
		const repository = await createTestRepository();
		const schedule = await createTestBackupSchedule({
			volumeId: volume.id,
			repositoryId: repository.id,
		});

		resticBackupMock.mockImplementationOnce((params: SafeSpawnParams) => {
			params.onStderr?.("error: open /mnt/data/private.db: permission denied");

			return Promise.resolve({
				exitCode: 3,
				summary: generateBackupOutput(),
				error: "Warning: at least one source file could not be read",
			});
		});

		await backupsService.executeBackup(schedule.id);
		await waitForBackupTaskStatus(schedule.id, "succeeded");

		const updatedSchedule = await getScheduleByIdOrShortId(schedule.id);
		const task = await getBackupTaskForSchedule(schedule.id);
		expect(updatedSchedule.lastBackupStatus).toBe("warning");
		expect(updatedSchedule.lastBackupError).toBe("error: open /mnt/data/private.db: permission denied");
		expect(task?.status).toBe("succeeded");
		expect(task?.result).toMatchObject({
			kind: "backup",
			exitCode: 3,
			warningDetails: "error: open /mnt/data/private.db: permission denied",
		});
		expect(notificationSpy).toHaveBeenLastCalledWith(
			schedule.id,
			"warning",
			expect.objectContaining({ error: "error: open /mnt/data/private.db: permission denied" }),
		);
	});

	test("should not warn when restic exits successfully with diagnostic stderr", async () => {
		const { resticBackupMock } = setup();
		const notificationSpy = vi.spyOn(notificationsService, "sendBackupNotification").mockResolvedValue();
		const volume = await createTestVolume();
		const repository = await createTestRepository();
		const schedule = await createTestBackupSchedule({
			volumeId: volume.id,
			repositoryId: repository.id,
		});

		resticBackupMock.mockImplementationOnce((params: SafeSpawnParams) => {
			params.onStderr?.("Load(<lock/b84b958297>, 0, 0) failed: Key not found");

			return Promise.resolve({
				exitCode: 0,
				summary: generateBackupOutput(),
				error: "",
			});
		});

		await backupsService.executeBackup(schedule.id);
		await waitForBackupTaskStatus(schedule.id, "succeeded");

		const updatedSchedule = await getScheduleByIdOrShortId(schedule.id);
		const task = await getBackupTaskForSchedule(schedule.id);
		expect(updatedSchedule.lastBackupStatus).toBe("success");
		expect(updatedSchedule.lastBackupError).toBeNull();
		expect(task?.status).toBe("succeeded");
		expect(task?.result).toMatchObject({
			kind: "backup",
			exitCode: 0,
			warningDetails: null,
		});
		expect(notificationSpy).toHaveBeenLastCalledWith(
			schedule.id,
			"success",
			expect.objectContaining({ error: undefined }),
		);
	});

	test("should store restic diagnostic details instead of the generic summary on hard failure", async () => {
		const { resticBackupMock } = setup();
		const volume = await createTestVolume();
		const repository = await createTestRepository();
		const schedule = await createTestBackupSchedule({
			volumeId: volume.id,
			repositoryId: repository.id,
		});

		resticBackupMock.mockImplementationOnce((params: SafeSpawnParams) => {
			params.onStderr?.("Permissions 0755 for '/tmp/zerobyte-ssh-key' are too open.");
			params.onStderr?.("This private key will be ignored.");

			return Promise.resolve({
				exitCode: 1,
				summary: "",
				error: "ssh command exited",
				stderr: "Permissions 0755 for '/tmp/zerobyte-ssh-key' are too open.\nThis private key will be ignored.",
			});
		});

		await backupsService.executeBackup(schedule.id);
		await waitForBackupTaskStatus(schedule.id, "failed");

		const updatedSchedule = await getScheduleByIdOrShortId(schedule.id);
		expect(updatedSchedule.lastBackupStatus).toBe("error");
		expect(updatedSchedule.lastBackupError).toBe(
			"Permissions 0755 for '/tmp/zerobyte-ssh-key' are too open.\nThis private key will be ignored.",
		);
	});

	test("should settle and mark the backup as failed when the backup process throws", async () => {
		const { resticBackupMock } = setup();
		const volume = await createTestVolume();
		const repository = await createTestRepository();
		const schedule = await createTestBackupSchedule({
			volumeId: volume.id,
			repositoryId: repository.id,
		});

		resticBackupMock.mockImplementationOnce(() => Promise.reject(new Error("restic crashed")));

		const backupStart = await backupsService.executeBackup(schedule.id);
		expect(backupStart).toMatchObject({ taskId: expect.any(String), status: "started" });
		await waitForBackupTaskStatus(schedule.id, "failed");

		const updatedSchedule = await getScheduleByIdOrShortId(schedule.id);
		expect(updatedSchedule.lastBackupStatus).toBe("error");
		expect(updatedSchedule.lastBackupError).toBe("Error: restic crashed");
	});

	test("should block forget on the same repository until the active backup completes", async () => {
		const { resticBackupMock, resticForgetMock, runBackupMock } = setup();
		const volume = await createTestVolume();
		const repository = await createTestRepository();
		const schedule = await createTestBackupSchedule({
			volumeId: volume.id,
			repositoryId: repository.id,
			retentionPolicy: { keepHourly: 24 },
		});

		let completeBackup: (() => void) | undefined;
		resticBackupMock.mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					completeBackup = () => resolve({ exitCode: 0, summary: generateBackupOutput(), error: "" });
				}),
		);

		const backupPromise = backupsService.executeBackup(schedule.id);

		await waitForExpect(() => {
			expect(runBackupMock).toHaveBeenCalledTimes(1);
		});

		let forgetFinished = false;
		const forgetPromise = backupsService.runForget(schedule.id).finally(() => {
			forgetFinished = true;
		});

		await new Promise((resolve) => setTimeout(resolve, 50));

		expect(resticForgetMock).not.toHaveBeenCalled();
		expect(forgetFinished).toBe(false);

		expect(completeBackup).toBeDefined();
		completeBackup?.();

		await backupPromise;
		await forgetPromise;

		expect(resticForgetMock).toHaveBeenCalled();
		expect(resticForgetMock).toHaveBeenCalledWith(
			repository.config,
			expect.objectContaining({ keepHourly: 24 }),
			expect.objectContaining({ tag: schedule.shortId, organizationId: TEST_ORG_ID }),
		);
	});

	test("supports cancellation through the generic task lifecycle", async () => {
		const { resticBackupMock } = setup();
		const volume = await createTestVolume();
		const repository = await createTestRepository();
		const schedule = await createTestBackupSchedule({
			volumeId: volume.id,
			repositoryId: repository.id,
		});

		resticBackupMock.mockImplementation(() => new Promise(() => {}));
		const executePromise = backupsService.executeBackup(schedule.id);
		let taskId: string | undefined;

		await waitForExpect(async () => {
			const task = await getBackupTaskForSchedule(schedule.id);
			expect(task?.status).toBe("running");
			taskId = task?.id;
		});

		if (!taskId) {
			throw new Error("Expected the backup task to be running");
		}
		expect(requestTaskCancel(taskId)).toBe(true);
		await executePromise;
		await waitForBackupTaskStatus(schedule.id, "cancelled");

		const task = await getBackupTaskForSchedule(schedule.id);
		const updatedSchedule = await getScheduleByIdOrShortId(schedule.id);
		expect(task?.status).toBe("cancelled");
		expect(task?.cancellationRequested).toBe(true);
		expect(updatedSchedule.lastBackupStatus).toBe("warning");
		expect(updatedSchedule.lastBackupError).toBe("Task was cancelled by the user");
	});

	test("cancels when the agent becomes unavailable while sending the backup command", async () => {
		const { runBackupMock } = setup();
		const volume = await createTestVolume();
		const repository = await createTestRepository();
		const schedule = await createTestBackupSchedule({
			volumeId: volume.id,
			repositoryId: repository.id,
			cronExpression: "0 0 1 1 *",
			maxRetries: 2,
			retryDelay: 60 * 1000,
		});

		runBackupMock.mockImplementationOnce(
			(_agentId, request) =>
				new Promise((resolve) => {
					request.signal.addEventListener(
						"abort",
						() => {
							resolve({
								status: "unavailable",
								error: new Error("Failed to send backup command to agent local"),
							});
						},
						{ once: true },
					);
				}),
		);

		await backupsService.executeBackup(schedule.id);
		let taskId: string | undefined;
		await waitForExpect(async () => {
			const task = await getBackupTaskForSchedule(schedule.id);
			expect(task?.status).toBe("running");
			taskId = task?.id;
		});

		if (!taskId) {
			throw new Error("Expected a running backup task");
		}

		expect(requestTaskCancel(taskId)).toBe(true);
		await waitForBackupTaskStatus(schedule.id, "cancelled");

		const cancelledTask = await getBackupTaskForSchedule(schedule.id);
		const cancelledSchedule = await getScheduleByIdOrShortId(schedule.id);
		expect(cancelledTask?.status).toBe("cancelled");
		expect(cancelledSchedule.lastBackupStatus).toBe("warning");
		expect(cancelledSchedule.lastBackupError).toBe("Task was cancelled by the user");
		expect(cancelledSchedule.failureRetryCount).toBe(0);
	});

	test("fails and schedules a retry when the agent reports failure after cancellation delivery fails", async () => {
		const { runBackupMock, cancelBackupMock } = setup();
		const volume = await createTestVolume();
		const repository = await createTestRepository();
		const schedule = await createTestBackupSchedule({
			volumeId: volume.id,
			repositoryId: repository.id,
			cronExpression: "0 0 1 1 *",
			maxRetries: 2,
			retryDelay: 60 * 1000,
		});
		let resolveBackup: ((result: { status: "failed"; error: string }) => void) | undefined;

		cancelBackupMock.mockRejectedValueOnce(new Error("cancellation transport failed"));
		runBackupMock.mockImplementationOnce(
			(_agentId, request) =>
				new Promise((resolve) => {
					resolveBackup = resolve;
					request.signal.addEventListener(
						"abort",
						() => {
							void agentManager.cancelBackup("local", request.scheduleId).catch(() => {});
						},
						{ once: true },
					);
				}),
		);

		await backupsService.executeBackup(schedule.id);
		let taskId: string | undefined;
		await waitForExpect(async () => {
			const task = await getBackupTaskForSchedule(schedule.id);
			expect(task?.status).toBe("running");
			taskId = task?.id;
		});

		expect(taskId).toBeDefined();
		if (!taskId || !resolveBackup) {
			throw new Error("Expected a running backup task");
		}

		expect(requestTaskCancel(taskId)).toBe(true);
		await waitForExpect(() => {
			expect(cancelBackupMock).toHaveBeenCalledWith("local", schedule.id);
		});
		resolveBackup({ status: "failed", error: "backup failed after cancellation" });

		await waitForBackupTaskStatus(schedule.id, "failed");

		const failedTask = await getBackupTaskForSchedule(schedule.id);
		const failedSchedule = await getScheduleByIdOrShortId(schedule.id);
		expect(failedTask?.status).toBe("failed");
		expect(failedTask?.error).toBe("backup failed after cancellation");
		expect(failedSchedule.lastBackupStatus).toBe("error");
		expect(failedSchedule.lastBackupError).toBe("backup failed after cancellation");
		expect(failedSchedule.failureRetryCount).toBe(1);
		expect(failedSchedule.nextBackupAt).toBeGreaterThan(Date.now());
	});

	test("should stop a queued backup before it acquires the repository lock", async () => {
		const { resticBackupMock } = setup();
		const volume = await createTestVolume();
		const repository = await createTestRepository();
		const schedule = await createTestBackupSchedule({
			volumeId: volume.id,
			repositoryId: repository.id,
		});

		const releaseLock = await repoMutex.acquireExclusive(repository.id, "test");
		const executePromise = backupsService.executeBackup(schedule.id);

		try {
			await waitForExpect(async () => {
				const queuedSchedule = await getScheduleByIdOrShortId(schedule.id);
				expect(queuedSchedule.lastBackupStatus).toBe("in_progress");
				const task = await getBackupTaskForSchedule(schedule.id);
				expect(task?.status).toBe("queued");
			});

			expect(resticBackupMock).not.toHaveBeenCalled();

			const queuedTask = await getBackupTaskForSchedule(schedule.id);
			expect(queuedTask).toBeDefined();
			if (!queuedTask) {
				throw new Error("Expected the backup task to be queued");
			}

			expect(requestTaskCancel(queuedTask.id)).toBe(true);
		} finally {
			releaseLock();
		}

		await executePromise;
		await waitForBackupTaskStatus(schedule.id, "cancelled");

		const updatedSchedule = await getScheduleByIdOrShortId(schedule.id);
		const task = await getBackupTaskForSchedule(schedule.id);
		expect(updatedSchedule.lastBackupStatus).toBe("warning");
		expect(updatedSchedule.lastBackupError).toBe("Task was cancelled by the user");
		expect(task?.status).toBe("cancelled");
		expect(task?.cancellationRequested).toBe(true);
		expect(resticBackupMock).not.toHaveBeenCalled();
	});

	test("should clear failureRetryCount when a scheduled retry is cancelled", async () => {
		const { resticBackupMock } = setup();
		const volume = await createTestVolume();
		const repository = await createTestRepository();
		const schedule = await createTestBackupSchedule({
			volumeId: volume.id,
			repositoryId: repository.id,
			cronExpression: "0 0 1 1 *",
			maxRetries: 3,
			retryDelay: 60 * 1000,
		});

		resticBackupMock.mockImplementationOnce(() =>
			Promise.resolve({ exitCode: 1, summary: generateBackupOutput(), error: "retry me" }),
		);

		await backupsService.executeBackup(schedule.id);
		await waitForBackupTaskStatus(schedule.id, "failed");

		const failedSchedule = await getScheduleByIdOrShortId(schedule.id);
		expect(failedSchedule.failureRetryCount).toBe(1);

		resticBackupMock.mockImplementationOnce(({ signal }: SafeSpawnParams) => {
			return new Promise((resolve) => {
				if (signal?.aborted) {
					resolve({ exitCode: 1, summary: "", error: "" });
					return;
				}

				signal?.addEventListener(
					"abort",
					() => {
						resolve({ exitCode: 1, summary: "", error: "" });
					},
					{ once: true },
				);
			});
		});

		const executePromise = backupsService.executeBackup(schedule.id);

		await waitForExpect(async () => {
			const retryingSchedule = await getScheduleByIdOrShortId(schedule.id);
			expect(retryingSchedule.lastBackupStatus).toBe("in_progress");
		});

		const retryTask = await getBackupTaskForSchedule(schedule.id);
		expect(retryTask).toBeDefined();
		if (!retryTask) {
			throw new Error("Expected the retry task to be running");
		}

		expect(requestTaskCancel(retryTask.id)).toBe(true);
		await executePromise;
		await waitForExpect(() => {
			const cancelledTask = taskStore.findById({ organizationId: TEST_ORG_ID, taskId: retryTask.id });
			expect(cancelledTask?.status).toBe("cancelled");
		});

		const cancelledSchedule = await getScheduleByIdOrShortId(schedule.id);
		expect(cancelledSchedule.lastBackupStatus).toBe("warning");
		expect(cancelledSchedule.failureRetryCount).toBe(0);
	});
});

describe("retention policy - runForget", () => {
	test("should execute forget with retention policy", async () => {
		// arrange
		const { resticForgetMock } = setup();
		const repository = await createTestRepository();
		const schedule = await createTestBackupSchedule({
			repositoryId: repository.id,
			retentionPolicy: {
				keepHourly: 24,
				keepDaily: 7,
				keepWeekly: 4,
				keepMonthly: 12,
				keepYearly: 3,
			},
		});

		// act
		await backupsService.runForget(schedule.id);

		// assert
		expect(resticForgetMock).toHaveBeenCalledWith(
			repository.config,
			expect.objectContaining({
				keepHourly: 24,
				keepDaily: 7,
				keepWeekly: 4,
				keepMonthly: 12,
				keepYearly: 3,
			}),
			expect.objectContaining({
				tag: schedule.shortId,
				organizationId: TEST_ORG_ID,
			}),
		);
	});

	test("should throw BadRequestError if no retention policy configured", async () => {
		// arrange
		setup();
		const repository = await createTestRepository();
		const schedule = await createTestBackupSchedule({
			repositoryId: repository.id,
			retentionPolicy: undefined,
		});

		// act & assert
		await expect(backupsService.runForget(schedule.id)).rejects.toThrow(
			"No retention policy configured for this schedule",
		);
	});

	test("should throw NotFoundError when schedule does not exist", async () => {
		setup();
		// act & assert
		await expect(backupsService.runForget(99999)).rejects.toThrow("Backup schedule not found");
	});

	test("should throw NotFoundError when repository does not exist", async () => {
		// arrange
		setup();
		const schedule = await createTestBackupSchedule({
			retentionPolicy: {
				keepHourly: 24,
			},
		});

		// act & assert
		await expect(backupsService.runForget(schedule.id, "non-existent-repo")).rejects.toThrow(
			"Repository not found",
		);
	});
});
