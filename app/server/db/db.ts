import { Database } from "bun:sqlite";
import { relations } from "./relations";
import path from "node:path";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { DATABASE_URL } from "../core/constants";
import fs from "node:fs";
import { config } from "../core/config";
import * as schema from "./schema";

fs.mkdirSync(path.dirname(DATABASE_URL), { recursive: true });

if (
	fs.existsSync(path.join(path.dirname(DATABASE_URL), "ironmount.db")) &&
	!fs.existsSync(DATABASE_URL)
) {
	fs.renameSync(
		path.join(path.dirname(DATABASE_URL), "ironmount.db"),
		DATABASE_URL,
	);
}

const sqlite = new Database(DATABASE_URL);
export const db = drizzle({ client: sqlite, relations, schema });

export const runDbMigrations = () => {
	let migrationsFolder: string;

	if (config.migrationsPath) {
		migrationsFolder = config.migrationsPath;
	} else if (config.__prod__) {
		migrationsFolder = path.join("/app", "assets", "migrations");
	} else {
		migrationsFolder = path.join(process.cwd(), "app", "drizzle");
	}

	migrate(db, { migrationsFolder });

	sqlite.run("PRAGMA foreign_keys = ON;");
};
