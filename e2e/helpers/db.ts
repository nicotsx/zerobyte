import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import path from "node:path";
import { DATABASE_URL } from "~/server/core/constants";
import { relations } from "~/server/db/relations";

const sqlite = createClient({ url: `file:${path.join(process.cwd(), "playwright", DATABASE_URL)}` });

export const db = drizzle({ client: sqlite, relations: relations });

export const resetDatabase = async () => {
	const cursor = await sqlite.execute("SELECT name FROM sqlite_master WHERE type='table'");
	const tables = cursor.rows
		.map((row) => row.name)
		.filter((name) => name !== "sqlite_sequence" && name !== "__drizzle_migrations") as string[];

	for (const table of tables) {
		await sqlite.execute(`DELETE FROM ${table}`);
	}
};
