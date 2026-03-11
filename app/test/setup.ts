import { beforeAll, mock } from "bun:test";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import path from "node:path";
import { cwd } from "node:process";
import { db } from "~/server/db/db";

import * as utils from "@zerobyte/core/utils";

void mock.module("@zerobyte/core/utils", () => {
	return {
		...utils,
		logger: {
			debug: () => {},
			info: () => {},
			warn: () => {},
			error: () => {},
		},
	};
});

void mock.module("~/server/utils/crypto", () => ({
	cryptoUtils: {
		deriveSecret: async () => "test-secret",
		sealSecret: async (v: string) => v,
		resolveSecret: async (v: string) => v,
		generateResticPassword: () => "test-restic-password",
	},
}));

beforeAll(async () => {
	const migrationsFolder = path.join(cwd(), "app", "drizzle");
	migrate(db, { migrationsFolder });
	db.run("PRAGMA foreign_keys = ON;");
});
