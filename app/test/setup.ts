import { beforeAll, mock } from "bun:test";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import path from "node:path";
import { cwd } from "node:process";
import * as schema from "~/server/db/schema";
import { db, setSchema } from "~/server/db/db";
import { initAuth } from "~/lib/auth";

setSchema(schema);

void mock.module("~/server/utils/logger", () => ({
	logger: {
		debug: () => {},
		info: () => {},
		warn: () => {},
		error: () => {},
	},
}));

void mock.module("~/server/utils/crypto", () => ({
	cryptoUtils: {
		deriveSecret: async () => "test-secret",
		sealSecret: async (v: string) => v,
		resolveSecret: async (v: string) => v,
	},
}));

beforeAll(async () => {
	const migrationsFolder = path.join(cwd(), "app", "drizzle");
	migrate(db, { migrationsFolder });
	await initAuth();
});
