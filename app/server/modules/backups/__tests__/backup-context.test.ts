import { describe, expect, test } from "vitest";
import { AGENT_REPOSITORY_FOREIGN_SOURCE_REASON } from "@zerobyte/contracts/backup-context";
import { assertBackupRepositoryCompatibility } from "../backup-context";

describe("assertBackupRepositoryCompatibility", () => {
	test("accepts sources on the machine that stores an agent repository", () => {
		expect(() =>
			assertBackupRepositoryCompatibility({ agentId: "machine-a" }, { type: "local", agentId: "machine-a" }),
		).not.toThrow();
	});

	test("rejects sources on any other machine, including this server", () => {
		expect(() =>
			assertBackupRepositoryCompatibility({ agentId: "local" }, { type: "local", agentId: "machine-a" }),
		).toThrow(AGENT_REPOSITORY_FOREIGN_SOURCE_REASON);
		expect(() =>
			assertBackupRepositoryCompatibility({ agentId: "machine-b" }, { type: "local", agentId: "machine-a" }),
		).toThrow(AGENT_REPOSITORY_FOREIGN_SOURCE_REASON);
	});
});
