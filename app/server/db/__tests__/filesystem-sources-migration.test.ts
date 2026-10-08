import { Database } from "bun:sqlite";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";

test("adds filesystem sources while preserving managed volumes and backup relationships", () => {
	const migrations = readMigrationFiles({
		migrationsFolder: fileURLToPath(new URL("../../../drizzle", import.meta.url)),
	});
	const migrationIndex = migrations.findIndex((migration) => migration.name === "20261011095835_sudden_dreadnoughts");
	expect(migrationIndex).toBeGreaterThan(0);
	const migration = migrations[migrationIndex];
	if (!migration) throw new Error("Filesystem source migration not found");

	const sqlite = new Database(":memory:");

	try {
		for (const migration of migrations.slice(0, migrationIndex)) {
			sqlite.exec(migration.sql.join("\n"));
		}

		sqlite.exec(`
			INSERT INTO organization (id, name, slug, created_at) VALUES ('org-1', 'Organization', 'organization', 1000);
			INSERT INTO volumes_table (id, short_id, name, type, config, organization_id)
				VALUES (1, 'managed', 'Managed', 'directory', '{"backend":"directory","path":"/data"}', 'org-1');
			INSERT INTO repositories_table (id, short_id, name, type, config, organization_id)
				VALUES ('repo-1', 'repository', 'Repository', 'local', '{"backend":"local","path":"/backups"}', 'org-1');
			INSERT INTO backup_schedules_table (id, short_id, name, volume_id, repository_id, cron_expression, organization_id)
				VALUES (1, 'backup-1', 'Backup', 1, 'repo-1', '0 0 * * *', 'org-1');
		`);
		const original = sqlite.prepare("SELECT * FROM volumes_table WHERE id = 1").get();
		if (!original || typeof original !== "object") throw new Error("Original managed volume not found");

		sqlite.exec("PRAGMA foreign_keys = OFF; BEGIN");
		sqlite.exec(migration.sql.join("\n"));
		sqlite.exec("COMMIT; PRAGMA foreign_keys = ON");

		expect(sqlite.prepare("SELECT * FROM volumes_table WHERE id = 1").get()).toEqual({
			...original,
			source_kind: "managed",
			trusted_root_id: null,
			relative_path: null,
		});
		expect(sqlite.query("SELECT id, volume_id, repository_id FROM backup_schedules_table").all()).toEqual([
			{ id: 1, volume_id: 1, repository_id: "repo-1" },
		]);
		expect(sqlite.query("PRAGMA foreign_key_check").all()).toEqual([]);

		sqlite.exec(`
			INSERT INTO volumes_table (id, short_id, name, source_kind, agent_id, trusted_root_id, relative_path, organization_id)
				VALUES (2, 'remote', 'Remote', 'filesystem', 'agent-1', 'photos', '', 'org-1');
		`);
		expect(sqlite.query("SELECT source_kind, config, type FROM volumes_table WHERE id = 2").get()).toEqual({
			source_kind: "filesystem",
			config: null,
			type: null,
		});
		expect(() => sqlite.exec("UPDATE volumes_table SET trusted_root_id = NULL WHERE id = 2")).toThrow();
		expect(() => sqlite.exec("UPDATE volumes_table SET config = NULL WHERE id = 1")).toThrow();
	} finally {
		sqlite.close();
	}
});
