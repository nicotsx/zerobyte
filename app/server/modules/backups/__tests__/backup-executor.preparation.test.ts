import * as fs from "node:fs/promises";
import * as os from "node:os";
import { tmpdir } from "node:os";
import * as nodeRuntime from "@zerobyte/core/node";
import { join } from "node:path";
import { afterEach, expect, test, vi } from "vitest";
import { backupExecutor } from "../backup-executor";
import { agentManager } from "../../agents/agents-manager";
import { createTestSession } from "~/test/helpers/auth";
import { createTestVolume } from "~/test/helpers/volume";
import { createTestRepository } from "~/test/helpers/repository";
import { createTestBackupSchedule } from "~/test/helpers/backup";
import { withContext } from "~/server/core/request-context";
import { db } from "~/server/db/db";
import { getVolumePath } from "../../volumes/helpers";

vi.mock("node:fs/promises", async (original) => ({ ...(await original<typeof fs>()) }));
vi.mock("node:os", async (original) => ({ ...(await original<typeof os>()) }));
vi.mock("@zerobyte/core/node", async (original) => ({ ...(await original<typeof nodeRuntime>()) }));
afterEach(() => vi.restoreAllMocks());

test("rejects non-local volumes before controller filesystem preparation or dispatch", async () => {
	const { organizationId } = await createTestSession();
	const volume = await createTestVolume({ organizationId, agentId: "remote-agent", status: "error" });
	const repository = await createTestRepository({
		organizationId,
		type: "s3",
		config: {
			backend: "s3",
			endpoint: "https://storage.example.test",
			bucket: "backups",
			accessKeyId: "test-access-key",
			secretAccessKey: "test-secret-key",
		},
	});
	const schedule = await createTestBackupSchedule({
		organizationId,
		volumeId: volume.id,
		repositoryId: repository.id,
	});
	const stat = vi.spyOn(fs, "stat");
	const dispatch = vi.spyOn(agentManager, "runBackup");

	await expect(
		withContext({ organizationId }, () =>
			backupExecutor.execute({
				jobId: "unsupported-agent",
				scheduleId: schedule.id,
				schedule,
				volume,
				repository,
				organizationId,
				signal: new AbortController().signal,
				onProgress: () => {},
			}),
		),
	).rejects.toThrow("Backups can only run on the local agent");

	expect(stat).not.toHaveBeenCalled();
	expect(dispatch).not.toHaveBeenCalled();
	expect(await db.query.volumesTable.findFirst({ where: { id: volume.id } })).toMatchObject({
		status: "error",
		lastError: null,
	});
});

test("controller prepares source health and dispatches only its path, never managed backend configuration", async () => {
	const { organizationId } = await createTestSession();
	const root = await fs.mkdtemp(join(tmpdir(), "zerobyte-source-preparation-"));

	try {
		const volume = await createTestVolume({
			organizationId,
			status: "error",
			autoRemount: false,
			config: { backend: "directory", path: root },
		});
		const repository = await createTestRepository({ organizationId });
		const schedule = await createTestBackupSchedule({
			organizationId,
			volumeId: volume.id,
			repositoryId: repository.id,
		});
		const dispatch = vi
			.spyOn(agentManager, "runBackup")
			.mockResolvedValue({ status: "completed", exitCode: 0, result: null, warningDetails: null });

		await withContext({ organizationId }, () =>
			backupExecutor.execute({
				jobId: "prepare-1",
				scheduleId: schedule.id,
				schedule,
				volume,
				repository,
				organizationId,
				signal: new AbortController().signal,
				onProgress: () => {},
			}),
		);

		expect(dispatch).toHaveBeenCalledOnce();
		const payload = dispatch.mock.calls[0]?.[1].payload;
		expect(payload?.source).toEqual({ kind: "controller-path", path: root });
		expect(payload).not.toHaveProperty("volume");
		expect(await db.query.volumesTable.findFirst({ where: { id: volume.id } })).toMatchObject({
			status: "mounted",
			lastError: null,
		});
	} finally {
		await fs.rm(root, { recursive: true, force: true });
	}
});

test("cancelling during controller filesystem preparation prevents backup dispatch", async () => {
	const { organizationId } = await createTestSession();
	const root = await fs.mkdtemp(join(tmpdir(), "zerobyte-cancel-preparation-"));

	try {
		const volume = await createTestVolume({
			organizationId,
			status: "mounted",
			config: { backend: "directory", path: root },
		});
		const repository = await createTestRepository({ organizationId });
		const schedule = await createTestBackupSchedule({
			organizationId,
			volumeId: volume.id,
			repositoryId: repository.id,
		});
		const dispatch = vi.spyOn(agentManager, "runBackup");
		const abort = new AbortController();
		const originalStat = fs.stat;
		vi.spyOn(fs, "stat").mockImplementation((...args) => {
			if (args[0] === root) abort.abort(new Error("cancelled during preparation"));
			return originalStat(...args);
		});

		await expect(
			withContext({ organizationId }, () =>
				backupExecutor.execute({
					jobId: "cancel-1",
					scheduleId: schedule.id,
					schedule,
					volume,
					repository,
					organizationId,
					signal: abort.signal,
					onProgress: () => {},
				}),
			),
		).rejects.toThrow("cancelled during preparation");
		expect(dispatch).not.toHaveBeenCalled();
	} finally {
		await fs.rm(root, { recursive: true, force: true });
	}
});

test("manually unmounted managed volume fails preparation without dispatch or automatic mounting", async () => {
	const { organizationId } = await createTestSession();
	const volume = await createTestVolume({
		organizationId,
		status: "unmounted",
		type: "nfs",
		config: { backend: "nfs", server: "nas", exportPath: "/data", version: "4", port: 2049, readOnly: false },
	});
	const repository = await createTestRepository({ organizationId });
	const schedule = await createTestBackupSchedule({
		organizationId,
		volumeId: volume.id,
		repositoryId: repository.id,
	});
	const dispatch = vi.spyOn(agentManager, "runBackup");

	await expect(
		withContext({ organizationId }, () =>
			backupExecutor.execute({
				jobId: "manual-1",
				scheduleId: schedule.id,
				schedule,
				volume,
				repository,
				organizationId,
				signal: new AbortController().signal,
				onProgress: () => {},
			}),
		),
	).rejects.toThrow("Volume is not mounted");
	expect(dispatch).not.toHaveBeenCalled();
	expect(await db.query.volumesTable.findFirst({ where: { id: volume.id } })).toMatchObject({ status: "unmounted" });
});

test.each(["health", "unmount"] as const)(
	"cancellation during controller network %s preserves recoverable status and prevents dispatch",
	async (phase) => {
		const { organizationId } = await createTestSession();
		const volume = await createTestVolume({
			organizationId,
			status: "mounted",
			autoRemount: true,
			type: "nfs",
			config: { backend: "nfs", server: "nas", exportPath: "/data", version: "4", port: 2049, readOnly: false },
		});
		const repository = await createTestRepository({ organizationId });
		const schedule = await createTestBackupSchedule({
			organizationId,
			volumeId: volume.id,
			repositoryId: repository.id,
		});
		const abort = new AbortController();
		const dispatch = vi.spyOn(agentManager, "runBackup");
		vi.spyOn(os, "platform").mockReturnValue("linux");
		vi.spyOn(fs, "access").mockImplementation(async () => {
			if (phase === "health") abort.abort(new Error("cancelled during network preparation"));
			throw new Error("stale mount");
		});
		vi.spyOn(fs, "readFile").mockResolvedValue(`10 9 0:1 / ${getVolumePath(volume)} rw - nfs nas:/data rw`);
		vi.spyOn(fs, "rmdir").mockResolvedValue();
		const execute = vi.spyOn(nodeRuntime, "safeExec").mockImplementation(async () => {
			abort.abort(new Error("cancelled during network preparation"));
			return { exitCode: 0, timedOut: false, stdout: "", stderr: "" };
		});

		await expect(
			withContext({ organizationId }, () =>
				backupExecutor.execute({
					jobId: "cancel-network",
					scheduleId: schedule.id,
					schedule,
					volume,
					repository,
					organizationId,
					signal: abort.signal,
					onProgress: () => {},
				}),
			),
		).rejects.toThrow("cancelled during network preparation");

		expect(dispatch).not.toHaveBeenCalled();
		expect(execute.mock.calls.map(([request]) => request.command)).toEqual(phase === "unmount" ? ["umount"] : []);
		expect(await db.query.volumesTable.findFirst({ where: { id: volume.id } })).toMatchObject({
			status: "error",
			lastError: "Volume is not mounted",
			autoRemount: true,
		});
	},
);
