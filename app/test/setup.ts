import { beforeAll, mock } from "bun:test";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import path from "node:path";
import { cwd } from "node:process";
import { db } from "~/server/db/db";
import { initModules } from "../server/modules/lifecycle/bootstrap";


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
		generateResticPassword: () => "test-restic-password",
	},
}));

beforeAll(async () => {
	await initModules();

	const migrationsFolder = path.join(cwd(), "app", "drizzle");
	migrate(db, { migrationsFolder });
});
