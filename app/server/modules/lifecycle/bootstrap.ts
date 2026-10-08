import { runDbMigrations } from "../../db/db";
import { startAgentController, startLocalAgent, stopAgentController } from "../agents/agents-manager";
import { agentsService } from "../agents/agents.service";
import { runMigrations } from "./migrations";
import { prepareStartup, activateScheduledJobs } from "./startup";
import { Scheduler } from "../../core/scheduler";

export const bootstrapApplication = async () => {
	const bootstrapStartedAt = Date.now();

	await runDbMigrations();
	await runMigrations();
	await agentsService.ensureLocalAgent();
	await agentsService.markStaleRemoteAgentsOffline();

	try {
		await startAgentController();

		await prepareStartup(bootstrapStartedAt);

		await startLocalAgent();
		await activateScheduledJobs();
	} catch (error) {
		try {
			await Scheduler.stop();
		} finally {
			await stopAgentController();
		}

		throw error;
	}
};
