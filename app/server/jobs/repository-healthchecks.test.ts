import { afterEach, describe, expect, test, vi } from "vitest";
import { db } from "~/server/db/db";
import type { Repository } from "~/server/db/schema";
import { repositoriesService } from "~/server/modules/repositories/repositories.service";
import { RepositoryHealthCheckJob } from "./repository-healthchecks";

describe("RepositoryHealthCheckJob", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	test("skips repositories opted out of automatic health checks", async () => {
		const enabledRepository = {
			name: "Enabled repository",
			organizationId: "organization-id",
			shortId: "enabled-repository",
		} as Repository;
		const findMany = vi
			.spyOn(db.query.repositoriesTable, "findMany")
			.mockResolvedValue([enabledRepository] as never);
		const checkHealth = vi.spyOn(repositoriesService, "checkHealth").mockResolvedValue({ lastError: null });

		const job = new RepositoryHealthCheckJob();
		await job.run();

		expect(findMany).toHaveBeenCalledWith({
			where: {
				AND: [{ OR: [{ status: "healthy" }, { status: "error" }] }, { autoCheckEnabled: true }],
			},
		});
		expect(checkHealth).toHaveBeenCalledWith(enabledRepository.shortId);
	});
});
