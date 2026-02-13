import { runDbMigrations } from "../../db/db";
import { runMigrations } from "./migrations";
import { startup } from "./startup";

let bootstrapPromise: Promise<void> | undefined;

const runBootstrap = async () => {
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
