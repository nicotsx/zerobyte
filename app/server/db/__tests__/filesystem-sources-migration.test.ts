import { Database } from "bun:sqlite";
import { readFileSync } from "node:fs";
import { expect, test } from "vitest";

test("renames existing filesystem sources without changing backup relationships", () => {
	const previousMigration = readFileSync(
		new URL("../../../drizzle/20260807172554_fine_polaris/migration.sql", import.meta.url),
		"utf8",
	);
	const previousVolumesSchema = previousMigration.match(/CREATE TABLE `__new_volumes_table`[\s\S]*?\n\);/)?.[0];
	if (!previousVolumesSchema) throw new Error("Missing historical volumes schema");

	const migration = readFileSync(
		new URL("../../../drizzle/20261010080646_filesystem-sources/migration.sql", import.meta.url),
		"utf8",
	);
	const sqlite = new Database(":memory:");

	try {
		sqlite.exec("PRAGMA foreign_keys = ON; CREATE TABLE organization (id TEXT PRIMARY KEY);");
		sqlite.exec(previousVolumesSchema.replace("__new_volumes_table", "volumes_table"));
		sqlite.exec(`
			CREATE TABLE backups (id INTEGER PRIMARY KEY, volume_id INTEGER REFERENCES volumes_table(id));
			INSERT INTO organization VALUES ('org-1');
			INSERT INTO volumes_table (id, short_id, name, type, config, organization_id)
				VALUES (1, 'managed', 'Managed', 'directory', '{"backend":"directory","path":"/data"}', 'org-1');
			INSERT INTO volumes_table (id, short_id, name, source_kind, agent_id, trusted_root_id, relative_path, organization_id)
				VALUES (2, 'remote', 'Remote', 'agent-filesystem', 'agent-1', 'data', 'photos', 'org-1');
			INSERT INTO backups VALUES (1, 1), (2, 2);
		`);

		sqlite.exec(migration);

		expect(sqlite.query("SELECT id, source_kind FROM volumes_table ORDER BY id").all()).toEqual([
			{ id: 1, source_kind: "managed" },
			{ id: 2, source_kind: "filesystem" },
		]);
		expect(sqlite.query("SELECT id, volume_id FROM backups ORDER BY id").all()).toEqual([
			{ id: 1, volume_id: 1 },
			{ id: 2, volume_id: 2 },
		]);
		expect(sqlite.query("PRAGMA foreign_key_check").all()).toEqual([]);
		expect(() => sqlite.exec("UPDATE volumes_table SET source_kind = 'agent-filesystem' WHERE id = 2")).toThrow();
	} finally {
		sqlite.close();
	}
});
