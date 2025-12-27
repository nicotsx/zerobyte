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
	let migrationsFolder: string;

	// Migration path priority:
	// 1. MIGRATIONS_PATH env var (Nix, custom deployments)
	// 2. /app/assets/migrations (Docker production)
	// 3. /app/app/drizzle (Docker development)
	if (config.migrationsPath) {
		migrationsFolder = config.migrationsPath;
	} else if (config.__prod__) {
		migrationsFolder = path.join("/app", "assets", "migrations");
	} else {
		migrationsFolder = path.join("/app", "app", "drizzle");
	}

	migrate(db, { migrationsFolder });

	sqlite.run("PRAGMA foreign_keys = ON;");
};
