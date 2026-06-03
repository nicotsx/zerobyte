import { runDbMigrations } from "../../db/db";
import { config } from "../../core/config";
import { startAgentController, startLocalAgent, stopAgentController, stopLocalAgent } from "../agents/agents-manager";
import { agentsService } from "../agents/agents.service";
import { runMigrations } from "./migrations";
import { startup } from "./startup";

let bootstrapPromise: Promise<void> | undefined;

const runBootstrap = async () => {
	await runDbMigrations();
	await runMigrations();
	await agentsService.ensureLocalAgent();

	try {
		await startAgentController();

		if (config.flags.enableLocalAgent) {
			await startLocalAgent();
		}

		await startup();
	} catch (error) {
		await stopLocalAgent();
		await stopAgentController();
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
		await stopLocalAgent();
		await stopAgentController();
	} finally {
		bootstrapPromise = undefined;
	}
};
