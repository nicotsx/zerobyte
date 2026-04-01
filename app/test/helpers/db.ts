import fs from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { vi } from "vitest";

export const createTestDb = async () => {
	const projectRoot = process.cwd();
	const cacheRoot = fs.mkdtempSync(path.join(tmpdir(), "zerobyte-test-cache-"));

	process.env.ZEROBYTE_DATABASE_URL = ":memory:";
	vi.resetModules();

	const database = await import("~/server/db/db");

	await database.runDbMigrations();

	process.chdir(cacheRoot);
	try {
		await import("~/server/utils/cache");
	} finally {
		process.chdir(projectRoot);
	}

	return database;
};
