import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import type { RepositoryConfig } from "~/schemas/restic";
import { REPOSITORY_BASE } from "~/server/core/constants";
import { serverEvents } from "~/server/core/events";
import { withContext } from "~/server/core/request-context";
import { db } from "~/server/db/db";
import { repositoriesTable } from "~/server/db/schema";
import { generateShortId } from "~/server/utils/id";
import { restic } from "~/server/utils/restic";
import { createTestSession } from "~/test/helpers/auth";
import { repositoriesService } from "../repositories.service";

describe("repositoriesService.createRepository", () => {
	const initMock = mock(() => Promise.resolve({ success: true, error: null }));

	beforeEach(() => {
		initMock.mockClear();
		spyOn(restic, "init").mockImplementation(initMock);
	});

	afterEach(() => {
		mock.restore();
	});

	test("creates a shortId-scoped repository path when using the repository base directory", async () => {
		// arrange
		const { organizationId, user } = await createTestSession();
		const config: RepositoryConfig = { backend: "local", path: REPOSITORY_BASE };

		// act
		const result = await withContext({ organizationId, userId: user.id }, () =>
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

	test("keeps an explicit local repository path unchanged", async () => {
		// arrange
		const { organizationId, user } = await createTestSession();
		const explicitPath = `${REPOSITORY_BASE}/custom-${randomUUID()}`;
		const config: RepositoryConfig = { backend: "local", path: explicitPath };

		// act
		const result = await withContext({ organizationId, userId: user.id }, () =>
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
		expect(savedConfig.path).toBe(explicitPath);
		expect(created.status).toBe("healthy");
	});
});

describe("repositoriesService.dumpSnapshot", () => {
	afterEach(() => {
		mock.restore();
	});

	test("calls restic.dump with common-ancestor selector and stripped path", async () => {
		const { organizationId, user } = await createTestSession();
		const shortId = generateShortId();
		const basePath = "/var/lib/zerobyte/volumes/vol123/_data";

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

		const snapshotsMock = mock(() =>
			Promise.resolve([
				{
					id: "snapshot-123",
					short_id: "snapshot-123",
					time: new Date().toISOString(),
					tree: "tree-1",
					paths: [basePath],
					hostname: "host",
				},
			]),
		);
		spyOn(restic, "snapshots").mockImplementation(snapshotsMock as typeof restic.snapshots);

		const dumpMock = mock(() =>
			Promise.resolve({
				stream: Readable.from([]),
				completion: Promise.resolve(),
				abort: () => {},
			}),
		);
		spyOn(restic, "dump").mockImplementation(dumpMock);
		const emitSpy = spyOn(serverEvents, "emit");

		await withContext({ organizationId, userId: user.id }, () =>
			repositoriesService.dumpSnapshot(shortId, "snapshot-123", `${basePath}/documents`),
		);

		expect(dumpMock).toHaveBeenCalledTimes(1);
		expect(dumpMock).toHaveBeenCalledWith(
			expect.objectContaining({
				backend: "local",
			}),
			`snapshot-123:${basePath}`,
			{
				organizationId,
				path: "/documents",
			},
		);
		expect(emitSpy).toHaveBeenCalledWith(
			"dump:started",
			expect.objectContaining({
				organizationId,
				repositoryId: shortId,
				snapshotId: "snapshot-123",
				path: "/documents",
			}),
		);
	});

	test("downloads full snapshot relative to common ancestor when path is omitted", async () => {
		const { organizationId, user } = await createTestSession();
		const shortId = generateShortId();
		const basePath = "/var/lib/zerobyte/volumes/vol555/_data";

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

		const snapshotsMock = mock(() =>
			Promise.resolve([
				{
					id: "snapshot-999",
					short_id: "snapshot-999",
					time: new Date().toISOString(),
					tree: "tree-9",
					paths: [basePath],
					hostname: "host",
				},
			]),
		);
		spyOn(restic, "snapshots").mockImplementation(snapshotsMock as typeof restic.snapshots);

		const dumpMock = mock(() =>
			Promise.resolve({
				stream: Readable.from([]),
				completion: Promise.resolve(),
				abort: () => {},
			}),
		);
		spyOn(restic, "dump").mockImplementation(dumpMock);

		await withContext({ organizationId, userId: user.id }, () =>
			repositoriesService.dumpSnapshot(shortId, "snapshot-999"),
		);

		expect(dumpMock).toHaveBeenCalledWith(expect.anything(), `snapshot-999:${basePath}`, {
			organizationId,
			path: "/",
		});
	});
});
