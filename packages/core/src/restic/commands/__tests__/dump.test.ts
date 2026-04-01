import { PassThrough } from "node:stream";
import { spawn } from "node:child_process";
import { afterEach, describe, expect, test, vi } from "vitest";
import * as cleanupModule from "../../helpers/cleanup-temporary-keys";
import * as nodeModule from "../../../node";
import { dump } from "../dump";
import type { ResticDeps } from "../../types";

const mockDeps: ResticDeps = {
	resolveSecret: async (s) => s,
	getOrganizationResticPassword: async () => "org-restic-password",
	resticCacheDir: "/tmp/restic-cache",
	resticPassFile: "/tmp/restic.pass",
	defaultExcludes: ["/tmp/restic.pass", "/var/lib/zerobyte/repositories"],
};

const config = {
	backend: "local" as const,
	path: "/tmp/restic-repo",
	isExistingRepository: true,
	customPassword: "custom-password",
};

const setup = () => {
	let capturedArgs: string[] = [];

	vi.spyOn(cleanupModule, "cleanupTemporaryKeys").mockImplementation(() => Promise.resolve());
	vi.spyOn(nodeModule, "safeSpawn").mockImplementation((params) => {
		capturedArgs = params.args;
		const child = { stdout: new PassThrough() } as unknown as ReturnType<typeof spawn>;
		params.onSpawn?.(child);
		return Promise.resolve({ exitCode: 0, summary: "", error: "" });
	});

	return {
		getArgs: () => capturedArgs,
	};
};

afterEach(() => {
	vi.restoreAllMocks();
});

describe("dump command", () => {
	test("treats snapshot reference as a positional arg", async () => {
		const { getArgs } = setup();

		const result = await dump(config, "--help", { organizationId: "org-1", path: "folder/file.txt" }, mockDeps);
		await result.completion;

		expect(getArgs()).toEqual([
			"--repo",
			"/tmp/restic-repo",
			"dump",
			"--archive",
			"tar",
			"--",
			"--help",
			"/folder/file.txt",
		]);
	});
});
