import waitForExpect from "wait-for-expect";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import nodePath from "node:path";
import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import type { RepositoryConfig } from "@zerobyte/core/restic";
import { REPOSITORY_BASE } from "~/server/core/constants";
import { withContext } from "~/server/core/request-context";
import { db } from "~/server/db/db";
import { repositoriesTable } from "~/server/db/schema";
import { generateShortId } from "~/server/utils/id";
import { restic } from "~/server/core/restic";
import { createTestSession } from "~/test/helpers/auth";
import { createTestBackupSchedule } from "~/test/helpers/backup";
import { cache, cacheKeys } from "~/server/utils/cache";
import { ResticError } from "@zerobyte/core/restic/server";
import { repositoriesService } from "../repositories.service";

const createTestRepository = async (organizationId: string) => {
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
		})
		.returning();
	return repository;
};

let session: Awaited<ReturnType<typeof createTestSession>>;

beforeAll(async () => {
	session = await createTestSession();
});

describe("repositoriesService.createRepository", () => {
	const initMock = vi.fn(() => Promise.resolve({ success: true, error: null }));

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
		const config: RepositoryConfig = { backend: "local", path: explicitPath, isExistingRepository: true };

		vi.spyOn(restic, "snapshots").mockImplementation(() => Promise.resolve([]));

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

		const statsSpy = vi.spyOn(restic, "stats").mockResolvedValue(expectedStats);

		const refreshed = await withContext({ organizationId: session.organizationId, userId: session.user.id }, () =>
			repositoriesService.refreshRepositoryStats(repository.shortId),
		);

		expect(refreshed).toEqual(expectedStats);
		expect(statsSpy).toHaveBeenCalledTimes(1);

		const persistedRepository = await db.query.repositoriesTable.findFirst({ where: { id: repository.id } });
		expect(persistedRepository?.stats).toEqual(expectedStats);
		expect(typeof persistedRepository?.statsUpdatedAt).toBe("number");

		const loaded = await withContext({ organizationId: session.organizationId, userId: session.user.id }, () =>
			repositoriesService.getRepositoryStats(repository.shortId),
		);

		expect(loaded).toEqual(expectedStats);
		expect(statsSpy).toHaveBeenCalledTimes(1);
	});
});

describe("repositoriesService.dumpSnapshot", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	const createDumpResult = (payload: string) => ({
		stream: Readable.from([payload]),
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

		vi.spyOn(restic, "snapshots").mockResolvedValue([
			{
				id: snapshotId,
				short_id: snapshotId,
				time: new Date().toISOString(),
				paths: snapshotPaths ?? [basePath],
				hostname: "host",
			},
		]);

		const dumpMock = vi.fn((_config: unknown, snapshotRef: string, options: Parameters<typeof restic.dump>[2]) => {
			if (!options.path) {
				throw new Error("Expected dump path in test");
			}

			return Promise.resolve(
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
});

describe("repositoriesService.restoreSnapshot", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	const setupRestoreSnapshotScenario = async () => {
		const organizationId = session.organizationId;
		const repository = await createTestRepository(organizationId);

		vi.spyOn(restic, "snapshots").mockResolvedValue([
			{
				id: "snapshot-restore",
				short_id: "snapshot-restore",
				time: new Date().toISOString(),
				paths: ["/var/lib/zerobyte/volumes/vol123/_data"],
				hostname: "host",
			},
		]);

		const restoreMock = vi.fn(() =>
			Promise.resolve({
				message_type: "summary" as const,
				seconds_elapsed: 1,
				percent_done: 100,
				files_skipped: 0,
				total_files: 1,
				files_restored: 1,
				total_bytes: 1,
				bytes_restored: 1,
			}),
		);
		vi.spyOn(restic, "restore").mockImplementation(restoreMock);

		return {
			organizationId,
			userId: session.user.id,
			repositoryShortId: repository.shortId,
			restoreMock,
		};
	};

	test("rejects restore targets inside protected roots", async () => {
		const { organizationId, userId, repositoryShortId, restoreMock } = await setupRestoreSnapshotScenario();
		const targetPath = nodePath.join(os.tmpdir(), "zerobyte-restore-target");

		await expect(
			withContext({ organizationId, userId }, () =>
				repositoriesService.restoreSnapshot(repositoryShortId, "snapshot-restore", { targetPath }),
			),
		).rejects.toThrow("Restore target path is not allowed");

		expect(restoreMock).not.toHaveBeenCalled();
	});

	test("restores to a custom target outside protected roots", async () => {
		const { organizationId, userId, repositoryShortId, restoreMock } = await setupRestoreSnapshotScenario();
		const targetPath = await fs.mkdtemp(nodePath.join(process.cwd(), "restore-target-"));

		try {
			await withContext({ organizationId, userId }, () =>
				repositoriesService.restoreSnapshot(repositoryShortId, "snapshot-restore", { targetPath }),
			);
		} finally {
			await fs.rm(targetPath, { recursive: true, force: true });
		}

		expect(restoreMock).toHaveBeenCalledWith(
			expect.objectContaining({
				backend: "local",
			}),
			"snapshot-restore",
			targetPath,
			expect.objectContaining({
				organizationId,
				basePath: "/var/lib/zerobyte/volumes/vol123/_data",
			}),
		);
	});
});

describe("repositoriesService.getRetentionCategories", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	test("recomputes retention categories after repository cache invalidation", async () => {
		const organizationId = session.organizationId;
		const schedule = await createTestBackupSchedule({ organizationId, retentionPolicy: { keepLast: 1 } });

		const repository = await db.query.repositoriesTable.findFirst({ where: { id: schedule.repositoryId } });

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
		forgetSpy.mockResolvedValueOnce(buildForgetResponse(oldSnapshotId));
		forgetSpy.mockResolvedValueOnce(buildForgetResponse(newSnapshotId));

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

	test("refreshes repository stats in background after successful deletion", async () => {
		const repository = await createTestRepository(session.organizationId);
		const expectedStats = {
			total_size: 128,
			total_uncompressed_size: 256,
			compression_ratio: 2,
			compression_progress: 50,
			compression_space_saving: 50,
			snapshots_count: 1,
		};

		vi.spyOn(restic, "deleteSnapshot").mockResolvedValue({ success: true });
		const statsSpy = vi.spyOn(restic, "stats").mockResolvedValue(expectedStats);

		await withContext({ organizationId: session.organizationId, userId: session.user.id }, () =>
			repositoriesService.deleteSnapshot(repository.shortId, "snap-1"),
		);

		await waitForExpect(() => {
			expect(statsSpy).toHaveBeenCalledTimes(1);
		});

		const updatedRepository = await db.query.repositoriesTable.findFirst({ where: { id: repository.id } });
		expect(updatedRepository?.stats).toEqual(expectedStats);
		expect(typeof updatedRepository?.statsUpdatedAt).toBe("number");
	});

	test("should throw original error when restic deleteSnapshot fails", async () => {
		const repository = await createTestRepository(session.organizationId);

		vi.spyOn(restic, "deleteSnapshot").mockImplementation(async () => {
			throw new ResticError(1, "Fatal: unexpected HTTP response (403): 403 Forbidden");
		});

		await expect(
			withContext({ organizationId: session.organizationId, userId: session.user.id }, () =>
				repositoriesService.deleteSnapshot(repository.shortId, "snap123"),
			),
		).rejects.toThrow("Fatal: unexpected HTTP response");
	});
});
