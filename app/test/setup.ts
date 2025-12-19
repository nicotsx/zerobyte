import { beforeAll, mock } from "bun:test";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import path from "node:path";
import { cwd } from "node:process";
import { db } from "~/server/db/db";

mock.module("~/server/utils/logger", () => ({
	logger: {
		debug: () => {},
		info: () => {},
		warn: () => {},
		error: () => {},
	},
}));

beforeAll(async () => {
	const migrationsFolder = path.join(cwd(), "app", "drizzle");
	migrate(db, { migrationsFolder });
});
