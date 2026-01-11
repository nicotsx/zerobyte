import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import path from "node:path";
import { DATABASE_URL } from "~/server/core/constants";
import * as schema from "~/server/db/schema";

const sqlite = createClient({ url: `file:${path.join(process.cwd(), "data", DATABASE_URL)}` });

export const db = drizzle({ client: sqlite, schema: schema });

export const resetDatabase = async () => {
	for (const table of Object.values(schema)) {
		if ("getSQL" in table) {
			await db
				.delete(table)
				.execute()
				.catch(() => {
					/* Ignore errors */
				});
		}
	}
};
