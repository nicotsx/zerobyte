import waitForExpect from "wait-for-expect";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import nodePath from "node:path";
import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import { Effect } from "effect";
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import type { RepositoryConfig } from "@zerobyte/core/restic";
import { REPOSITORY_BASE } from "~/server/core/constants";
import { config } from "~/server/core/config";
import { withContext } from "~/server/core/request-context";
import { db } from "~/server/db/db";
import { agentsTable, repositoriesTable, type RepositoryInsert } from "~/server/db/schema";
import { generateShortId } from "~/server/utils/id";
import { restic } from "~/server/core/restic";
import { agentManager, type RestoreExecutionResult } from "~/server/modules/agents/agents-manager";
import { createTestSession } from "~/test/helpers/auth";
import { createTestBackupSchedule } from "~/test/helpers/backup";
import { cache, cacheKeys } from "~/server/utils/cache";
import { ResticError } from "@zerobyte/core/restic/server";
import { repoMutex } from "~/server/core/repository-mutex";
import { taskStore } from "~/server/modules/tasks/tasks.store";
import { repositoriesService } from "../repositories.service";

const createTestRepository = async (organizationId: string, overrides: Partial<RepositoryInsert> = {}) => {
	const id = randomUUID();
	const shortId = generateShortId();
	const [repository] = await db
		.insert(repositoriesTable)
		.values({
			id,
			shortId,
			name: `Test-${randomUUID()}`,
			type: "local",
			config: { backend: "local", path: "/tmp" },
			compressionMode: "auto",
			status: "healthy",
			organizationId,
			...overrides,
		})
		.returning();
	return repository;
};

const resolveWithin = async <T>(promise: Promise<T>, timeoutMs: number) => {
	return await new Promise<T>((resolve, reject) => {
		const timeout = setTimeout(() => {
			reject(new Error(`Expected promise to resolve within ${timeoutMs}ms`));
		}, timeoutMs);

		promise.then(
			(value) => {
				clearTimeout(timeout);
				resolve(value);
			},
			(error) => {
				clearTimeout(timeout);
				reject(error);
			},
		);
	});
};

let session: Awaited<ReturnType<typeof createTestSession>>;

beforeAll(async () => {
	session = await createTestSession();
});

describe("repositoriesService.createRepository", () => {
	const initMock = vi.fn(() => Effect.succeed({ success: true, error: null }));

	beforeEach(() => {
		initMock.mockClear();
		vi.spyOn(restic, "init").mockImplementation(initMock);
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	test("creates a shortId-scoped repository path when using the repository base directory", async () => {
		// arrange
		const config: RepositoryConfig = { backend: "local", path: REPOSITORY_BASE };

		// act
		const result = await withContext({ organizationId: session.organizationId, userId: session.user.id }, () =>
			repositoriesService.createRepository("main repo", config),
		);

		const created = await db.query.repositoriesTable.findFirst({
			where: {
				id: result.repository.id,
			},
		});

		// assert
		expect(created).toBeTruthy();
		if (!created) {
			throw new Error("Repository should be created");
		}

		const savedConfig = created.config as Extract<RepositoryConfig, { backend: "local" }>;

		expect(savedConfig.path).toBe(`${REPOSITORY_BASE}/${created.shortId}`);
		expect(savedConfig.path).not.toBe(REPOSITORY_BASE);
		expect(created.status).toBe("healthy");
	});

	test("creates a shortId-scoped repository path when using a custom directory", async () => {
		// arrange
		const explicitPath = `${REPOSITORY_BASE}/custom-${randomUUID()}`;
		const config: RepositoryConfig = { backend: "local", path: explicitPath };

		// act
		const result = await withContext({ organizationId: session.organizationId, userId: session.user.id }, () =>
			repositoriesService.createRepository("custom repo", config),
		);

		const created = await db.query.repositoriesTable.findFirst({
			where: {
				id: result.repository.id,
			},
		});

		// assert
		expect(created).toBeTruthy();
		if (!created) {
			throw new Error("Repository should be created");
		}

		const savedConfig = created.config as Extract<RepositoryConfig, { backend: "local" }>;
		expect(savedConfig.path).toBe(`${explicitPath}/${created.shortId}`);
		expect(savedConfig.path).not.toBe(explicitPath);
		expect(created.status).toBe("healthy");
	});

	test("keeps an explicit local repository path unchanged when importing existing repository", async () => {
		// arrange
		const explicitPath = `${REPOSITORY_BASE}/custom-${randomUUID()}`;
		const config: RepositoryConfig = {
			backend: "local",
			path: explicitPath,
			isExistingRepository: true,
		};

		vi.spyOn(restic, "snapshots").mockImplementation(() => Effect.succeed([]));

		// act
		const result = await withContext({ organizationId: session.organizationId, userId: session.user.id }, () =>
			repositoriesService.createRepository("existing repo", config),
		);

		const created = await db.query.repositoriesTable.findFirst({
			where: {
				id: result.repository.id,
			},
		});

		// assert
		expect(created).toBeTruthy();
		if (!created) {
			throw new Error("Repository should be created");
		}

		const savedConfig = created.config as Extract<RepositoryConfig, { backend: "local" }>;
		expect(savedConfig.path).toBe(explicitPath);
		expect(created.status).toBe("healthy");
	});
});

describe("repositoriesService repository stats", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	test("returns empty stats when repository has not been populated yet", async () => {
		const repository = await createTestRepository(session.organizationId);

		const stats = await withContext({ organizationId: session.organizationId, userId: session.user.id }, () =>
			repositoriesService.getRepositoryStats(repository.shortId),
		);

		expect(stats).toEqual({
			total_size: 0,
			total_uncompressed_size: 0,
			compression_ratio: 0,
			compression_progress: 0,
			compression_space_saving: 0,
			snapshots_count: 0,
		});
	});

	test("refreshes and persists repository stats", async () => {
		const repository = await createTestRepository(session.organizationId);
		const expectedStats = {
			total_size: 1024,
			total_uncompressed_size: 2048,
			compression_ratio: 2,
			compression_progress: 50,
			compression_space_saving: 50,
			snapshots_count: 3,
		};

		const statsSpy = vi.spyOn(restic, "stats").mockReturnValue(Effect.succeed(expectedStats));

		const refreshed = await withContext({ organizationId: session.organizationId, userId: session.user.id }, () =>
			repositoriesService.refreshRepositoryStats(repository.shortId),
		);

		expect(refreshed).toEqual(expectedStats);
		expect(statsSpy).toHaveBeenCalledTimes(1);

		const persistedRepository = await db.query.repositoriesTable.findFirst({
			where: { id: repository.id },
		});
		expect(persistedRepository?.stats).toEqual(expectedStats);
		expect(typeof persistedRepository?.statsUpdatedAt).toBe("number");

		const loaded = await withContext({ organizationId: session.organizationId, userId: session.user.id }, () =>
			repositoriesService.getRepositoryStats(repository.shortId),
		);

		expect(loaded).toEqual(expectedStats);
		expect(statsSpy).toHaveBeenCalledTimes(1);
	});
});

describe("repositoriesService.listSnapshotFiles", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	test("limits concurrent restic ls commands per repository", async () => {
		const repository = await createTestRepository(session.organizationId);
		let active = 0;
		let maxActive = 0;
		let releaseAll = false;
		let exclusiveAcquired = false;
		let releaseExclusive: (() => void) | undefined;
		let exclusivePromise: Promise<() => void> | undefined;
		const releaseWaiters: Array<() => void> = [];
		const exclusiveController = new AbortController();

		const releaseWaitingCommands = () => {
			const waiters = releaseWaiters.splice(0);
			for (const release of waiters) {
				release();
			}
		};

		const resolveWithin = async <T>(promise: Promise<T>, timeoutMs: number) => {
			return await new Promise<T>((resolve, reject) => {
				const timeout = setTimeout(() => {
					reject(new Error(`Expected promise to resolve within ${timeoutMs}ms`));
				}, timeoutMs);

				promise.then(
					(value) => {
						clearTimeout(timeout);
						resolve(value);
					},
					(error) => {
						clearTimeout(timeout);
						reject(error);
					},
				);
			});
		};

		const lsSpy = vi.spyOn(restic, "ls").mockImplementation((_config, snapshotId, _path, options) =>
			Effect.promise(async () => {
				active++;
				maxActive = Math.max(maxActive, active);

				try {
					if (!releaseAll) {
						await new Promise<void>((resolve) => releaseWaiters.push(resolve));
					}

					return {
						snapshot: {
							id: snapshotId,
							short_id: snapshotId,
							time: new Date().toISOString(),
							tree: "tree",
							paths: ["/"],
							hostname: "host",
							struct_type: "snapshot" as const,
							message_type: "snapshot" as const,
						},
						nodes: [],
						pagination: {
							offset: options.offset ?? 0,
							limit: options.limit ?? 500,
							total: 0,
							hasMore: false,
						},
					};
				} finally {
					active--;
				}
			}),
		);

		const calls = Array.from({ length: 4 }, (_, index) =>
			withContext({ organizationId: session.organizationId, userId: session.user.id }, () =>
				repositoriesService.listSnapshotFiles(repository.shortId, `snapshot-${index}`, "/", {
					offset: 0,
					limit: 100,
				}),
			),
		);

		try {
			await waitForExpect(() => {
				expect(releaseWaiters).toHaveLength(2);
			});
			expect(maxActive).toBe(2);

			exclusivePromise = repoMutex
				.acquireExclusive(repository.id, "delete", exclusiveController.signal)
				.then((release) => {
					exclusiveAcquired = true;
					releaseExclusive = release;
					return release;
				});

			releaseWaitingCommands();

			releaseExclusive = await resolveWithin(exclusivePromise, 2000);
			expect(exclusiveAcquired).toBe(true);
			expect(active).toBe(0);

			releaseExclusive();
			releaseExclusive = undefined;

			await waitForExpect(() => {
				expect(releaseWaiters).toHaveLength(2);
			});
			expect(maxActive).toBe(2);

			releaseWaitingCommands();
			await Promise.all(calls);
		} finally {
			if (releaseExclusive) {
				releaseExclusive();
			} else {
				exclusiveController.abort();
			}
			releaseAll = true;
			releaseWaitingCommands();
			await Promise.allSettled(calls);
			if (exclusivePromise) {
				await Promise.allSettled([exclusivePromise]);
			}
		}

		expect(lsSpy).toHaveBeenCalledTimes(4);
		expect(maxActive).toBeLessThanOrEqual(2);
	});
});

describe("repositoriesService.dumpSnapshot", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	const createDumpResult = (payload: string) => ({
		stream: Readable.from([payload]) as never,
		completion: Promise.resolve(),
		abort: () => {},
	});

	const readStreamText = async (stream: Readable) => {
		const chunks: Buffer[] = [];
		for await (const chunk of stream) {
			chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
		}

		return Buffer.concat(chunks).toString("utf8");
	};

	const setupDumpSnapshotScenario = async ({
		snapshotId,
		basePath,
		snapshotPaths,
	}: {
		snapshotId: string;
		basePath: string;
		snapshotPaths?: string[];
	}) => {
		const organizationId = session.organizationId;
		const shortId = generateShortId();

		await db.insert(repositoriesTable).values({
			id: randomUUID(),
			shortId,
			name: `Repository-${randomUUID()}`,
			type: "local",
			config: {
				backend: "local",
				path: `/tmp/repository-${randomUUID()}`,
				isExistingRepository: true,
			},
			compressionMode: "off",
			organizationId,
		});

		vi.spyOn(restic, "snapshots").mockReturnValue(
			Effect.succeed([
				{
					id: snapshotId,
					short_id: snapshotId,
					time: new Date().toISOString(),
					paths: snapshotPaths ?? [basePath],
					hostname: "host",
				},
			]),
		);

		const dumpMock = vi.fn((_config: unknown, snapshotRef: string, options: Parameters<typeof restic.dump>[2]) => {
			if (!options.path) {
				throw new Error("Expected dump path in test");
			}

			return Effect.succeed(
				createDumpResult(
					JSON.stringify({
						snapshotRef,
						path: options.path,
						archive: options.archive !== false,
					}),
				),
			);
		});
		vi.spyOn(restic, "dump").mockImplementation(dumpMock);

		return {
			organizationId,
			userId: session.user.id,
			shortId,
			basePath,
		};
	};

	test("returns a tar download rooted at the selected directory within the snapshot", async () => {
		const { organizationId, userId, shortId, basePath } = await setupDumpSnapshotScenario({
			snapshotId: "snapshot-123",
			basePath: "/var/lib/zerobyte/volumes/vol123/_data",
		});

		const result = await withContext({ organizationId, userId }, () =>
			repositoriesService.dumpSnapshot(shortId, "snapshot-123", `${basePath}/documents`, "dir"),
		);

		expect(result.filename).toBe("snapshot-snapshot-123.tar");
		expect(result.contentType).toBe("application/x-tar");
		expect(await readStreamText(result.stream)).toBe(
			JSON.stringify({
				snapshotRef: `snapshot-123:${basePath}`,
				path: "/documents",
				archive: true,
			}),
		);
		await expect(result.completion).resolves.toBeUndefined();
	});

	test("streams a single file directly when selected path is a file", async () => {
		const { organizationId, userId, shortId, basePath } = await setupDumpSnapshotScenario({
			snapshotId: "snapshot-file",
			basePath: "/var/lib/zerobyte/volumes/vol123/_data",
		});

		const result = await withContext({ organizationId, userId }, () =>
			repositoriesService.dumpSnapshot(shortId, "snapshot-file", `${basePath}/documents/report.txt`, "file"),
		);

		expect(result.filename).toBe("report.txt");
		expect(result.contentType).toBe("application/octet-stream");
		expect(await readStreamText(result.stream)).toBe(
			JSON.stringify({
				snapshotRef: `snapshot-file:${basePath}`,
				path: "/documents/report.txt",
				archive: false,
			}),
		);
	});

	test("downloads a selected parent directory when snapshot paths point to a nested file", async () => {
		const parentPath = "/var/lib/zerobyte/volumes/vol123/_data/documents";
		const { organizationId, userId, shortId } = await setupDumpSnapshotScenario({
			snapshotId: "snapshot-parent-dir",
			basePath: `${parentPath}/report.txt`,
			snapshotPaths: [`${parentPath}/report.txt`],
		});

		const result = await withContext({ organizationId, userId }, () =>
			repositoriesService.dumpSnapshot(shortId, "snapshot-parent-dir", parentPath, "dir"),
		);

		expect(result.filename).toBe("snapshot-snapshot-parent-dir.tar");
		expect(result.contentType).toBe("application/x-tar");
		expect(await readStreamText(result.stream)).toBe(
			JSON.stringify({
				snapshotRef: `snapshot-parent-dir:${parentPath}`,
				path: "/",
				archive: true,
			}),
		);
	});

	test("rejects path downloads without a kind", async () => {
		const { organizationId, userId, shortId, basePath } = await setupDumpSnapshotScenario({
			snapshotId: "snapshot-no-kind",
			basePath: "/var/lib/zerobyte/volumes/vol123/_data",
		});

		await expect(
			withContext({ organizationId, userId }, () =>
				repositoriesService.dumpSnapshot(shortId, "snapshot-no-kind", `${basePath}/documents/report.txt`),
			),
		).rejects.toThrow("Path kind is required when downloading a specific snapshot path");
	});

	test("downloads the full snapshot from the common ancestor when path is omitted", async () => {
		const { organizationId, userId, shortId, basePath } = await setupDumpSnapshotScenario({
			snapshotId: "snapshot-999",
			basePath: "/var/lib/zerobyte/volumes/vol555/_data",
		});

		const result = await withContext({ organizationId, userId }, () =>
			repositoriesService.dumpSnapshot(shortId, "snapshot-999"),
		);

		expect(result.filename).toBe("snapshot-snapshot-999.tar");
		expect(result.contentType).toBe("application/x-tar");
		expect(await readStreamText(result.stream)).toBe(
			JSON.stringify({
				snapshotRef: `snapshot-999:${basePath}`,
				path: "/",
				archive: true,
			}),
		);
	});

	test("downloads the full snapshot from root when source paths are non-posix", async () => {
		const { organizationId, userId, shortId } = await setupDumpSnapshotScenario({
			snapshotId: "snapshot-windows",
			basePath: "/tmp/repro/source",
			snapshotPaths: ["d:\\some\\path"],
		});

		const result = await withContext({ organizationId, userId }, () =>
			repositoriesService.dumpSnapshot(shortId, "snapshot-windows"),
		);

		expect(result.filename).toBe("snapshot-snapshot-windows.tar");
		expect(result.contentType).toBe("application/x-tar");
		expect(await readStreamText(result.stream)).toBe(
			JSON.stringify({
				snapshotRef: "snapshot-windows",
				path: "/",
				archive: true,
			}),
		);
	});
});

describe("repositoriesService.restoreSnapshot", () => {
	let originalEnableLocalAgent: boolean;
	const createPendingRestoreStart = () => ({
		status: "started" as const,
		result: new Promise<RestoreExecutionResult>(() => {}),
	});
	const resolveWithin = async <T>(promise: Promise<T>, timeoutMs: number) => {
		return await new Promise<T>((resolve, reject) => {
			const timeout = setTimeout(() => {
				reject(new Error(`Expected promise to resolve within ${timeoutMs}ms`));
			}, timeoutMs);

			promise.then(
				(value) => {
					clearTimeout(timeout);
					resolve(value);
				},
				(error) => {
					clearTimeout(timeout);
					reject(error);
				},
			);
		});
	};

	beforeEach(() => {
		originalEnableLocalAgent = config.flags.enableLocalAgent;
		config.flags.enableLocalAgent = true;
	});

	afterEach(() => {
		config.flags.enableLocalAgent = originalEnableLocalAgent;
		vi.restoreAllMocks();
	});

	const setupRestoreSnapshotScenario = async (paths = ["/var/lib/zerobyte/volumes/vol123/_data"]) => {
		const organizationId = session.organizationId;
		const repository = await createTestRepository(organizationId);

		vi.spyOn(restic, "snapshots").mockReturnValue(
			Effect.succeed([
				{
					id: "snapshot-restore",
					short_id: "snapshot-restore",
					time: new Date().toISOString(),
					paths,
					hostname: "host",
				},
			]),
		);

		const restoreMock = vi.fn<typeof agentManager.startRestore>(() => Promise.resolve(createPendingRestoreStart()));
		vi.spyOn(agentManager, "startRestore").mockImplementation(restoreMock);

		return {
			organizationId,
			userId: session.user.id,
			repositoryId: repository.id,
			repositoryShortId: repository.shortId,
			restoreMock,
		};
	};

	test("rejects protected targets even when the local agent is enabled", async () => {
		const { organizationId, userId, repositoryShortId, restoreMock } = await setupRestoreSnapshotScenario();
		const targetPath = nodePath.join(os.tmpdir(), "zerobyte-restore-target");

		await expect(
			withContext({ organizationId, userId }, () =>
				repositoriesService.restoreSnapshot(repositoryShortId, "snapshot-restore", {
					targetPath,
				}),
			),
		).rejects.toThrow("Restore target path is not allowed");

		expect(restoreMock).not.toHaveBeenCalled();
	});

	test("restores to a custom target outside protected roots", async () => {
		const { organizationId, userId, repositoryShortId, restoreMock } = await setupRestoreSnapshotScenario();
		const targetPath = await fs.mkdtemp(nodePath.join(process.cwd(), "restore-target-"));

		try {
			await withContext({ organizationId, userId }, () =>
				repositoriesService.restoreSnapshot(repositoryShortId, "snapshot-restore", {
					targetPath,
				}),
			);
		} finally {
			await fs.rm(targetPath, { recursive: true, force: true });
		}

		await waitForExpect(() => {
			expect(restoreMock).toHaveBeenCalledWith(
				"local",
				expect.objectContaining({
					payload: expect.objectContaining({
						snapshotId: "snapshot-restore",
						target: targetPath,
						repositoryConfig: expect.objectContaining({ backend: "local" }),
						options: expect.objectContaining({
							organizationId,
							basePath: "/var/lib/zerobyte/volumes/vol123/_data",
						}),
					}),
				}),
			);
		});
	});

	test("rejects starting a second active restore for the same snapshot", async () => {
		const { organizationId, userId, repositoryShortId } = await setupRestoreSnapshotScenario();
		const targetPath = await fs.mkdtemp(nodePath.join(process.cwd(), "restore-target-"));

		try {
			await withContext({ organizationId, userId }, () =>
				repositoriesService.restoreSnapshot(repositoryShortId, "snapshot-restore", {
					targetPath,
				}),
			);

			await expect(
				withContext({ organizationId, userId }, () =>
					repositoriesService.restoreSnapshot(repositoryShortId, "snapshot-restore", {
						targetPath,
					}),
				),
			).rejects.toThrow("A restore is already running for this snapshot");
		} finally {
			await fs.rm(targetPath, { recursive: true, force: true });
		}
	});

	test("returns a restore id while waiting for the repository mutex", async () => {
		const { organizationId, userId, repositoryId, repositoryShortId, restoreMock } =
			await setupRestoreSnapshotScenario();
		const targetPath = await fs.mkdtemp(nodePath.join(process.cwd(), "restore-target-"));
		await withContext({ organizationId, userId }, () =>
			repositoriesService.getSnapshotDetails(repositoryShortId, "snapshot-restore"),
		);

		let finishRestore: (result: RestoreExecutionResult) => void = () => {};
		const restoreResult = new Promise<RestoreExecutionResult>((resolve) => {
			finishRestore = resolve;
		});
		restoreMock.mockResolvedValueOnce({ status: "started", result: restoreResult });

		const releaseExclusive = await repoMutex.acquireExclusive(repositoryId, "check");
		let restoreId = "";
		try {
			const restoreStart = withContext({ organizationId, userId }, () =>
				repositoriesService.restoreSnapshot(repositoryShortId, "snapshot-restore", {
					targetPath,
				}),
			);

			const result = await resolveWithin(restoreStart, 1000);
			restoreId = result.restoreId;

			expect(result.status).toBe("started");
			expect(restoreMock).not.toHaveBeenCalled();

			const task = taskStore.findActiveByResource({
				organizationId,
				kind: "restore",
				resourceType: "repository",
				resourceId: repositoryShortId,
			});
			expect(task?.id).toBe(restoreId);
			expect(task?.status).toBe("running");
		} finally {
			releaseExclusive();
			await fs.rm(targetPath, { recursive: true, force: true });
		}

		await waitForExpect(() => {
			expect(restoreMock).toHaveBeenCalledTimes(1);
		});

		finishRestore({
			status: "completed",
			result: {
				message_type: "summary",
				files_skipped: 0,
				files_restored: 1,
			},
		});

		await waitForExpect(() => {
			expect(
				taskStore.findActiveByResource({
					organizationId,
					kind: "restore",
					resourceType: "repository",
					resourceId: repositoryShortId,
				}),
			).toBeNull();
		});
	});

	test("routes restore to the requested target agent", async () => {
		const organizationId = session.organizationId;
		const agentId = `agent-${randomUUID()}`;
		const repository = await createTestRepository(organizationId, {
			type: "s3",
			config: {
				backend: "s3",
				endpoint: "https://s3.example.com",
				bucket: "bucket",
				accessKeyId: "access-key",
				secretAccessKey: "secret-key",
			},
		});
		await db.insert(agentsTable).values({
			id: agentId,
			organizationId,
			name: "Remote Agent",
			kind: "remote",
			status: "online",
			capabilities: {},
			updatedAt: Date.now(),
		});
		vi.spyOn(restic, "snapshots").mockReturnValue(
			Effect.succeed([
				{
					id: "snapshot-restore",
					short_id: "snapshot-restore",
					time: new Date().toISOString(),
					paths: ["/var/lib/zerobyte/volumes/vol123/_data"],
					hostname: "host",
				},
			]),
		);
		const restoreMock = vi.fn(() => Promise.resolve(createPendingRestoreStart()));
		vi.spyOn(agentManager, "startRestore").mockImplementation(restoreMock);
		const targetPath = await fs.mkdtemp(nodePath.join(process.cwd(), "restore-target-"));

		try {
			await withContext({ organizationId, userId: session.user.id }, () =>
				repositoriesService.restoreSnapshot(repository.shortId, "snapshot-restore", {
					targetPath,
					targetAgentId: agentId,
				}),
			);
		} finally {
			await fs.rm(targetPath, { recursive: true, force: true });
		}

		await waitForExpect(() => {
			expect(restoreMock).toHaveBeenCalledWith(
				agentId,
				expect.objectContaining({
					payload: expect.objectContaining({
						target: targetPath,
					}),
				}),
			);
		});
	});

	test("rejects a target agent outside the current organization", async () => {
		const organizationId = session.organizationId;
		const otherSession = await createTestSession();
		const otherAgentId = `agent-${randomUUID()}`;
		const repository = await createTestRepository(organizationId, {
			type: "s3",
			config: {
				backend: "s3",
				endpoint: "https://s3.example.com",
				bucket: "bucket",
				accessKeyId: "access-key",
				secretAccessKey: "secret-key",
			},
		});

		await db.insert(agentsTable).values({
			id: otherAgentId,
			organizationId: otherSession.organizationId,
			name: "Other Org Agent",
			kind: "remote",
			status: "online",
			capabilities: {},
			updatedAt: Date.now(),
		});
		vi.spyOn(restic, "snapshots").mockReturnValue(
			Effect.succeed([
				{
					id: "snapshot-restore",
					short_id: "snapshot-restore",
					time: new Date().toISOString(),
					paths: ["/var/lib/zerobyte/volumes/vol123/_data"],
					hostname: "host",
				},
			]),
		);
		const restoreMock = vi.fn(() => Promise.resolve(createPendingRestoreStart()));
		vi.spyOn(agentManager, "startRestore").mockImplementation(restoreMock);

		await expect(
			withContext({ organizationId, userId: session.user.id }, () =>
				repositoriesService.restoreSnapshot(repository.shortId, "snapshot-restore", {
					targetAgentId: otherAgentId,
				}),
			),
		).rejects.toThrow("Restore target agent not found");

		expect(restoreMock).not.toHaveBeenCalled();
	});

	test("uses controller-local restore fallback when local agent supervision is disabled", async () => {
		config.flags.enableLocalAgent = false;
		const { organizationId, userId, repositoryShortId, restoreMock } = await setupRestoreSnapshotScenario();
		const resticRestoreMock = vi.spyOn(restic, "restore").mockReturnValue(
			Effect.succeed({
				message_type: "summary" as const,
				files_skipped: 0,
				files_restored: 1,
			}),
		);
		const targetPath = await fs.mkdtemp(nodePath.join(process.cwd(), "restore-target-"));

		try {
			await withContext({ organizationId, userId }, () =>
				repositoriesService.restoreSnapshot(repositoryShortId, "snapshot-restore", {
					targetPath,
				}),
			);
		} finally {
			await fs.rm(targetPath, { recursive: true, force: true });
		}

		expect(restoreMock).not.toHaveBeenCalled();
		await waitForExpect(() => {
			expect(resticRestoreMock).toHaveBeenCalledWith(
				expect.objectContaining({ backend: "local" }),
				"snapshot-restore",
				targetPath,
				expect.objectContaining({
					organizationId,
					basePath: "/var/lib/zerobyte/volumes/vol123/_data",
					signal: expect.any(AbortSignal),
				}),
			);
		});
	});

	test("rejects original-location restore for snapshots with non-posix source paths", async () => {
		const { organizationId, userId, repositoryShortId, restoreMock } = await setupRestoreSnapshotScenario([
			"d:\\some\\path",
		]);

		await expect(
			withContext({ organizationId, userId }, () =>
				repositoriesService.restoreSnapshot(repositoryShortId, "snapshot-restore", {
					include: ["/tmp/source"],
					selectedItemKind: "dir",
				}),
			),
		).rejects.toThrow("Original location restore is unavailable for this snapshot");

		expect(restoreMock).not.toHaveBeenCalled();
	});

	test("allows restore-all to a custom target for snapshots with non-posix source paths", async () => {
		const { organizationId, userId, repositoryShortId, restoreMock } = await setupRestoreSnapshotScenario([
			"d:\\some\\path",
		]);
		const targetPath = await fs.mkdtemp(nodePath.join(process.cwd(), "restore-target-"));

		try {
			await withContext({ organizationId, userId }, () =>
				repositoriesService.restoreSnapshot(repositoryShortId, "snapshot-restore", {
					targetPath,
				}),
			);
		} finally {
			await fs.rm(targetPath, { recursive: true, force: true });
		}

		await waitForExpect(() => {
			expect(restoreMock).toHaveBeenCalledWith(
				"local",
				expect.objectContaining({
					payload: expect.objectContaining({
						snapshotId: "snapshot-restore",
						target: targetPath,
						repositoryConfig: expect.objectContaining({ backend: "local" }),
						options: expect.objectContaining({
							organizationId,
							basePath: "/",
						}),
					}),
				}),
			);
		});
	});
});

describe("repositoriesService.getRetentionCategories", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	test("recomputes retention categories after repository cache invalidation", async () => {
		const organizationId = session.organizationId;
		const schedule = await createTestBackupSchedule({
			organizationId,
			retentionPolicy: { keepLast: 1 },
		});

		const repository = await db.query.repositoriesTable.findFirst({
			where: { id: schedule.repositoryId },
		});

		expect(repository).toBeTruthy();
		if (!repository) {
			throw new Error("Repository should exist");
		}

		const oldSnapshotId = "snapshot-old";
		const newSnapshotId = "snapshot-new";
		const buildForgetResponse = (snapshotId: string) => ({
			success: true,
			data: [
				{
					tags: [schedule.shortId],
					host: "host",
					paths: ["/data"],
					keep: [],
					remove: null,
					reasons: [
						{
							snapshot: {
								id: snapshotId,
								short_id: snapshotId,
								time: new Date().toISOString(),
								tree: "tree",
								paths: ["/data"],
								hostname: "host",
							},
							matches: ["last snapshot"],
						},
					],
				},
			],
		});

		const forgetSpy = vi.spyOn(restic, "forget");
		forgetSpy.mockReturnValueOnce(Effect.succeed(buildForgetResponse(oldSnapshotId)));
		forgetSpy.mockReturnValueOnce(Effect.succeed(buildForgetResponse(newSnapshotId)));

		const firstCategories = await withContext({ organizationId, userId: session.user.id }, () =>
			repositoriesService.getRetentionCategories(repository.shortId, schedule.shortId),
		);

		expect(firstCategories.get(oldSnapshotId)).toEqual(["last"]);

		cache.delByPrefix(cacheKeys.repository.all(repository.id));

		const secondCategories = await withContext({ organizationId, userId: session.user.id }, () =>
			repositoriesService.getRetentionCategories(repository.shortId, schedule.shortId),
		);

		expect(secondCategories.get(newSnapshotId)).toEqual(["last"]);
		expect(secondCategories.has(oldSnapshotId)).toBe(false);
		expect(forgetSpy).toHaveBeenCalledTimes(2);
	});
});

describe("repositoriesService.deleteSnapshot", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	test("returns a delete task id while waiting for the repository mutex", async () => {
		const repository = await createTestRepository(session.organizationId);
		const expectedStats = {
			total_size: 128,
			total_uncompressed_size: 256,
			compression_ratio: 2,
			compression_progress: 50,
			compression_space_saving: 50,
			snapshots_count: 1,
		};

		const deleteSnapshotsSpy = vi
			.spyOn(restic, "deleteSnapshots")
			.mockReturnValue(Effect.succeed({ success: true }));
		const statsSpy = vi.spyOn(restic, "stats").mockReturnValue(Effect.succeed(expectedStats));

		const releaseExclusive = await repoMutex.acquireExclusive(repository.id, "check");
		try {
			const deleteStart = withContext({ organizationId: session.organizationId, userId: session.user.id }, () =>
				repositoriesService.deleteSnapshot(repository.shortId, "snap-1"),
			);

			const result = await resolveWithin(deleteStart, 1000);

			expect(result.status).toBe("started");
			expect(result.taskId).toEqual(expect.any(String));
			expect(deleteSnapshotsSpy).not.toHaveBeenCalled();

			const task = taskStore.findActiveByResource({
				organizationId: session.organizationId,
				kind: "deleteSnapshots",
				resourceType: "repository",
				resourceId: repository.shortId,
			});
			expect(task?.id).toBe(result.taskId);
			expect(task?.status).toBe("running");
		} finally {
			releaseExclusive();
		}

		await waitForExpect(() => {
			expect(deleteSnapshotsSpy).toHaveBeenCalledTimes(1);
			expect(deleteSnapshotsSpy).toHaveBeenCalledWith(repository.config, ["snap-1"], {
				organizationId: session.organizationId,
			});
			expect(statsSpy).toHaveBeenCalledTimes(1);
		});

		await waitForExpect(() => {
			expect(
				taskStore.findActiveByResource({
					organizationId: session.organizationId,
					kind: "deleteSnapshots",
					resourceType: "repository",
					resourceId: repository.shortId,
				}),
			).toBeNull();
		});

		const updatedRepository = await db.query.repositoriesTable.findFirst({
			where: { id: repository.id },
		});
		expect(updatedRepository?.stats).toEqual(expectedStats);
		expect(typeof updatedRepository?.statsUpdatedAt).toBe("number");
	});

	test("records restic delete failures on the delete task", async () => {
		const repository = await createTestRepository(session.organizationId);

		vi.spyOn(restic, "deleteSnapshots").mockImplementation(() =>
			Effect.fail(new ResticError(1, "Fatal: unexpected HTTP response (403): 403 Forbidden")),
		);

		const result = await withContext({ organizationId: session.organizationId, userId: session.user.id }, () =>
			repositoriesService.deleteSnapshot(repository.shortId, "snap123"),
		);

		expect(result.status).toBe("started");

		await waitForExpect(async () => {
			const task = await db.query.tasksTable.findFirst({ where: { id: result.taskId } });
			expect(task?.status).toBe("failed");
			expect(task?.error).toContain("Fatal: unexpected HTTP response");
		});
	});

	test("completes delete task before background repository stats refresh finishes", async () => {
		const repository = await createTestRepository(session.organizationId);
		const expectedStats = {
			total_size: 128,
			total_uncompressed_size: 256,
			compression_ratio: 2,
			compression_progress: 50,
			compression_space_saving: 50,
			snapshots_count: 1,
		};
		let finishStatsRefresh: () => void = () => {};
		const statsRefresh = new Promise<void>((resolve) => {
			finishStatsRefresh = resolve;
		});

		vi.spyOn(restic, "deleteSnapshots").mockReturnValue(Effect.succeed({ success: true }));
		const statsSpy = vi.spyOn(restic, "stats").mockReturnValue(
			Effect.promise(async () => {
				await statsRefresh;
				return expectedStats;
			}),
		);

		const result = await withContext({ organizationId: session.organizationId, userId: session.user.id }, () =>
			repositoriesService.deleteSnapshot(repository.shortId, "snap-1"),
		);

		await waitForExpect(() => {
			expect(statsSpy).toHaveBeenCalledTimes(1);
		});

		await waitForExpect(() => {
			expect(
				taskStore.findActiveByResource({
					organizationId: session.organizationId,
					kind: "deleteSnapshots",
					resourceType: "repository",
					resourceId: repository.shortId,
				}),
			).toBeNull();
		});

		const task = await db.query.tasksTable.findFirst({ where: { id: result.taskId } });
		expect(task?.status).toBe("succeeded");

		finishStatsRefresh();

		await waitForExpect(async () => {
			const updatedRepository = await db.query.repositoriesTable.findFirst({ where: { id: repository.id } });
			expect(updatedRepository?.stats).toEqual(expectedStats);
		});
	});

	test("starts another snapshot deletion while one is already active", async () => {
		const repository = await createTestRepository(session.organizationId);
		const expectedStats = {
			total_size: 128,
			total_uncompressed_size: 256,
			compression_ratio: 2,
			compression_progress: 50,
			compression_space_saving: 50,
			snapshots_count: 1,
		};
		const deleteSnapshotsSpy = vi
			.spyOn(restic, "deleteSnapshots")
			.mockReturnValue(Effect.succeed({ success: true }));
		const statsSpy = vi.spyOn(restic, "stats").mockReturnValue(Effect.succeed(expectedStats));

		const releaseExclusive = await repoMutex.acquireExclusive(repository.id, "check");
		try {
			const firstStart = withContext({ organizationId: session.organizationId, userId: session.user.id }, () =>
				repositoriesService.deleteSnapshot(repository.shortId, "snap-1"),
			);
			const secondStart = withContext({ organizationId: session.organizationId, userId: session.user.id }, () =>
				repositoriesService.deleteSnapshots(repository.shortId, ["snap-2", "snap-3"]),
			);

			const firstResult = await resolveWithin(firstStart, 1000);
			const secondResult = await resolveWithin(secondStart, 1000);

			expect(firstResult.status).toBe("started");
			expect(secondResult.status).toBe("started");
			expect(firstResult.taskId).not.toBe(secondResult.taskId);
			expect(deleteSnapshotsSpy).not.toHaveBeenCalled();
		} finally {
			releaseExclusive();
		}

		await waitForExpect(() => {
			expect(deleteSnapshotsSpy).toHaveBeenCalledTimes(2);
			expect(deleteSnapshotsSpy).toHaveBeenCalledWith(repository.config, ["snap-1"], {
				organizationId: session.organizationId,
			});
			expect(deleteSnapshotsSpy).toHaveBeenCalledWith(repository.config, ["snap-2", "snap-3"], {
				organizationId: session.organizationId,
			});
		});

		await waitForExpect(() => {
			expect(statsSpy).toHaveBeenCalledTimes(2);
		});
	});
});
