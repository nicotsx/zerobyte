import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import type { RepositoryConfig } from "~/schemas/restic";
import { REPOSITORY_BASE } from "~/server/core/constants";
import { withContext } from "~/server/core/request-context";
import { db } from "~/server/db/db";
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
