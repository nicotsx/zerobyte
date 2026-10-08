import { describe, expect, test } from "vitest";
import { REPOSITORY_BACKENDS, type RepositoryBackend } from "@zerobyte/core/restic";
import { getBackupRepositoryCompatibility } from "@zerobyte/contracts/backup-context";

const repositoryTypes = Object.keys(REPOSITORY_BACKENDS) as RepositoryBackend[];

describe("backup repository compatibility", () => {
	test("allows every repository for sources on this server", () => {
		for (const repositoryType of repositoryTypes) {
			expect(getBackupRepositoryCompatibility({ agentId: "local" }, repositoryType)).toEqual({
				compatible: true,
				reason: null,
			});
		}
	});

	test.each(repositoryTypes)("classifies remote source compatibility for %s", (repositoryType) => {
		const compatibility = getBackupRepositoryCompatibility({ agentId: "remote-agent" }, repositoryType);
		const expectedCompatible = repositoryType !== "local" && repositoryType !== "rclone";

		expect(compatibility.compatible).toBe(expectedCompatible);
		expect(compatibility.reason === null).toBe(expectedCompatible);
	});
});
