import * as schema from "../../db/schema";
import { runDbMigrations, setSchema } from "../../db/db";
import { runMigrations } from "./migrations";
import { startup } from "./startup";
import { initAuth } from "../../lib/auth";
import { logger } from "../../utils/logger";
import { toMessage } from "../../utils/errors";

let bootstrapPromise: Promise<void> | undefined;

export const initModules = async () => {
	setSchema(schema);

	await initAuth().catch((err) => {
		logger.error(`Error initializing auth: ${toMessage(err)}`);
		throw err;
	});
}

const runBootstrap = async () => {
	await initModules();

	runDbMigrations();
	await runMigrations();
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
