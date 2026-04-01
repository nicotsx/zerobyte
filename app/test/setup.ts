import "./setup-shared";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import path from "node:path";
import { cwd } from "node:process";
import { beforeAll } from "vitest";
import { db } from "~/server/db/db";

beforeAll(async () => {
	const migrationsFolder = path.join(cwd(), "app", "drizzle");
	migrate(db, { migrationsFolder });
	db.run("PRAGMA foreign_keys = ON;");
});
