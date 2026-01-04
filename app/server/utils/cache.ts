import { Database } from "bun:sqlite";
import path from "node:path";
import fs from "node:fs";
import { DATABASE_URL } from "../core/constants";

export const ONE_DAY_IN_SECONDS = 60 * 60 * 24;

export interface CacheOptions {
	dbPath?: string;
}

export const createCache = (options: CacheOptions = {}) => {
	const defaultPath = path.join(path.dirname(DATABASE_URL), "cache.db");
	const dbPath = options.dbPath || defaultPath;

	const dir = path.dirname(dbPath);
	if (!fs.existsSync(dir)) {
		fs.mkdirSync(dir, { recursive: true });
	}

	const db = new Database(dbPath);

	db.run("CREATE TABLE IF NOT EXISTS cache (key TEXT PRIMARY KEY, value TEXT, expiration INTEGER)");

	const set = (key: string, value: unknown, expirationSeconds = ONE_DAY_IN_SECONDS) => {
		const expiration = Date.now() + expirationSeconds * 1000;
		const stmt = db.prepare("INSERT OR REPLACE INTO cache (key, value, expiration) VALUES (?, ?, ?)");
		stmt.run(key, JSON.stringify(value), expiration);
	};

	const get = <T>(key: string): T | undefined => {
		const stmt = db.prepare("SELECT value, expiration FROM cache WHERE key = ?");
		const row = stmt.get(key) as { value: string; expiration: number } | undefined;

		if (!row) {
			return undefined;
		}

		if (row.expiration < Date.now()) {
			const delStmt = db.prepare("DELETE FROM cache WHERE key = ?");
			delStmt.run(key);
			return undefined;
		}

		try {
			return JSON.parse(row.value) as T;
		} catch {
			return undefined;
		}
	};

	const del = (key: string) => {
		const stmt = db.prepare("DELETE FROM cache WHERE key = ?");
		stmt.run(key);
	};

	const getByPrefix = <T>(prefix: string): { key: string; value: T }[] => {
		const stmt = db.prepare("SELECT key, value, expiration FROM cache WHERE key LIKE ?");
		const rows = stmt.all(`${prefix}%`) as { key: string; value: string; expiration: number }[];

		const now = Date.now();
		const results: { key: string; value: T }[] = [];

		for (const row of rows) {
			if (row.expiration < now) {
				const delStmt = db.prepare("DELETE FROM cache WHERE key = ?");
				delStmt.run(row.key);
				continue;
			}
			try {
				results.push({
					key: row.key,
					value: JSON.parse(row.value) as T,
				});
			} catch {
				// Ignore malformed entries
			}
		}

		return results;
	};

	const clear = () => {
		db.run("DELETE FROM cache");
	};

	return {
		set,
		get,
		del,
		getByPrefix,
		clear,
	};
};

export const cache = createCache();
