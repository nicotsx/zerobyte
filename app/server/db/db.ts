import { relations } from "./relations";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { drizzle } from "drizzle-orm/node-sqlite";
import { migrate } from "drizzle-orm/node-sqlite/migrator";
import { DATABASE_URL } from "../core/constants";
import fs from "node:fs";
import { config } from "../core/config";
import * as schema from "./schema";

fs.mkdirSync(path.dirname(DATABASE_URL), { recursive: true });

if (fs.existsSync(path.join(path.dirname(DATABASE_URL), "ironmount.db")) && !fs.existsSync(DATABASE_URL)) {
	fs.renameSync(path.join(path.dirname(DATABASE_URL), "ironmount.db"), DATABASE_URL);
}

export const sqlite = new DatabaseSync(DATABASE_URL, { enableDoubleQuotedStringLiterals: true });
export const db = drizzle({ client: sqlite, relations, schema });

let migrationsPromise: Promise<void> | undefined;

const runMigrations = async () => {
	let migrationsFolder: string;

	if (config.migrationsPath) {
		migrationsFolder = config.migrationsPath;
	} else if (config.__prod__) {
		migrationsFolder = path.join("/app", "assets", "migrations");
	} else {
		migrationsFolder = path.join(process.cwd(), "app", "drizzle");
	}

	migrate(db, { migrationsFolder });

	sqlite.exec("PRAGMA foreign_keys = ON;");
	sqlite.exec("PRAGMA busy_timeout = 5000;");
};

export const runDbMigrations = () => {
	if (!migrationsPromise) {
		migrationsPromise = runMigrations();
	}

	return migrationsPromise;
};
