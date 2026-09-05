import { runDbMigrations } from "../../db/db";
import { startAgentController, startLocalAgent, stopAgentController } from "../agents/agents-manager";
import { agentsService } from "../agents/agents.service";
import { runMigrations } from "./migrations";
import { prepareStartup, activateScheduledJobs } from "./startup";
import { Scheduler } from "../../core/scheduler";

let bootstrapPromise: Promise<void> | undefined;

const runBootstrap = async () => {
	const bootstrapStartedAt = Date.now();
	await runDbMigrations();
	await runMigrations();
	await agentsService.ensureLocalAgent();

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

export const bootstrapApplication = async () => {
	if (!bootstrapPromise) {
		bootstrapPromise = runBootstrap();
	}

	try {
		await bootstrapPromise;
	} catch (err) {
		bootstrapPromise = undefined;
		throw err;
	}
};

export const stopApplicationRuntime = async () => {
	try {
		await stopAgentController();
	} finally {
		bootstrapPromise = undefined;
	}
};
