import { afterEach, describe, expect, test, vi } from "vitest";
import { db } from "~/server/db/db";
import type { Repository } from "~/server/db/schema";
import { repositoriesService } from "~/server/modules/repositories/repositories.service";
import { agentManager } from "~/server/modules/agents/agents-manager";
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
			agentId: "local",
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

	test("skips repositories whose machine is offline without touching their health", async () => {
		const remoteRepository = {
			name: "Remote repository",
			organizationId: "organization-id",
			shortId: "remote-repository",
			agentId: "remote-agent",
		} as Repository;
		vi.spyOn(db.query.repositoriesTable, "findMany").mockResolvedValue([remoteRepository] as never);
		const isAgentReady = vi.spyOn(agentManager, "isAgentReady").mockReturnValue(false);
		const checkHealth = vi.spyOn(repositoriesService, "checkHealth").mockResolvedValue({ lastError: null });

		await new RepositoryHealthCheckJob().run();

		expect(isAgentReady).toHaveBeenCalledWith("remote-agent");
		expect(checkHealth).not.toHaveBeenCalled();
	});
});
