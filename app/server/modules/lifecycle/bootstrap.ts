import { runDbMigrations } from "../../db/db";
import { spawnLocalAgent, startAgentRuntime, stopAgentRuntime } from "../agents/agents-manager";
import { runMigrations } from "./migrations";
import { startup } from "./startup";

let bootstrapPromise: Promise<void> | undefined;

const runBootstrap = async () => {
	await runDbMigrations();
	await runMigrations();
	if (process.env.ENABLE_LOCAL_AGENT === "true") {
		await startAgentRuntime();
		await spawnLocalAgent();
	}
	await startup();
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
		await stopAgentRuntime();
	} finally {
		bootstrapPromise = undefined;
	}
};
