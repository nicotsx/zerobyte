import { describe, expect, test } from "vitest";
import { REPOSITORY_BACKENDS, type RepositoryBackend } from "@zerobyte/core/restic";
import { getBackupRepositoryCompatibility, type BackupSource } from "@zerobyte/contracts/backup-context";

const repositoryTypes = Object.keys(REPOSITORY_BACKENDS) as RepositoryBackend[];
const localSources: BackupSource[] = [{ kind: "managed" }, { kind: "agent-filesystem", agentKind: "local" }];

describe("backup repository compatibility", () => {
	test.each(localSources)("allows every repository for $kind sources", (source) => {
		for (const repositoryType of repositoryTypes) {
			expect(getBackupRepositoryCompatibility(source, repositoryType)).toEqual({
				compatible: true,
				reason: null,
			});
		}
	});

	test.each(repositoryTypes)("classifies remote source compatibility for %s", (repositoryType) => {
		const source: BackupSource = { kind: "agent-filesystem", agentKind: "remote" };
		const compatibility = getBackupRepositoryCompatibility(source, repositoryType);
		const expectedCompatible = repositoryType !== "local" && repositoryType !== "rclone";
		expect(compatibility.compatible).toBe(expectedCompatible);
		expect(compatibility.reason === null).toBe(expectedCompatible);
	});

	test("returns safe actionable reasons without repository configuration", () => {
		const source: BackupSource = { kind: "agent-filesystem", agentKind: "remote" };
		const local = getBackupRepositoryCompatibility(source, "local");
		const rclone = getBackupRepositoryCompatibility(source, "rclone");
		expect(local.reason).toBe("Local repositories are only available to sources on this server.");
		expect(rclone.reason).toBe(
			"Rclone repositories use configuration on this server and are unavailable to remote sources.",
		);
	});
});
