import "dotenv/config";
import { Database } from "bun:sqlite";
import path from "node:path";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { DATABASE_URL } from "../core/constants";
import * as schema from "./schema";
import fs from "node:fs/promises";
import { config } from "../core/config";

await fs.mkdir(path.dirname(DATABASE_URL), { recursive: true });

const sqlite = new Database(DATABASE_URL);
export const db = drizzle({ client: sqlite, schema });

export const runDbMigrations = () => {
	let migrationsFolder = path.join("/app", "assets", "migrations");

	if (!config.__prod__) {
		migrationsFolder = path.join("/app", "app", "drizzle");
	}

	migrate(db, { migrationsFolder });

	sqlite.run("PRAGMA foreign_keys = ON;");
};
