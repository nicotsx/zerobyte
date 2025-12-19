import { Job } from "../core/scheduler";
import { repositoriesService } from "../modules/repositories/repositories.service";
import { logger } from "../utils/logger";
import { db } from "../db/db";
import { eq, or } from "drizzle-orm";
import { repositoriesTable } from "../db/schema";

export class RepositoryHealthCheckJob extends Job {
	async run() {
		logger.debug("Running health check for all repositories...");

		const repositories = await db.query.repositoriesTable.findMany({
			where: or(eq(repositoriesTable.status, "healthy"), eq(repositoriesTable.status, "error")),
		});

		for (const repository of repositories) {
			try {
				await repositoriesService.checkHealth(repository.id);
			} catch (error) {
				logger.error(`Health check failed for repository ${repository.name}:`, error);
			}
		}

		return { done: true, timestamp: new Date() };
	}
}
