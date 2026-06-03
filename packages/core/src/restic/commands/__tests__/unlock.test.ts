import { Effect } from "effect";
import { afterEach, describe, expect, test, vi } from "vitest";
import * as nodeModule from "../../../node";
import { ResticLockError } from "../../error";
import * as cleanupModule from "../../helpers/cleanup-temporary-keys";
import type { ResticDeps } from "../../types";
import { unlock } from "../unlock";

const mockDeps: ResticDeps = {
	resolveSecret: async (s) => s,
	getOrganizationResticPassword: async () => "org-restic-password",
	resticCacheDir: "/tmp/restic-cache",
	resticPassFile: "/tmp/restic.pass",
	defaultExcludes: ["/tmp/restic.pass", "/var/lib/zerobyte/repositories"],
	rcloneConfigFile: "/root/.config/rclone/rclone.conf",
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
	vi.spyOn(nodeModule, "safeExec").mockImplementation(async ({ args }) => {
		capturedArgs = args ?? [];
		return { exitCode: 0, stdout: "", stderr: "", timedOut: false };
	});

	return {
		getArgs: () => capturedArgs,
	};
};

afterEach(() => {
	vi.restoreAllMocks();
});

describe("unlock command", () => {
	test("removes only stale locks by default", async () => {
		const { getArgs } = setup();

		await Effect.runPromise(unlock(config, { organizationId: "org-1" }, mockDeps));

		expect(getArgs()).toContain("unlock");
		expect(getArgs()).not.toContain("--remove-all");
	});

	test("can opt in to removing all locks", async () => {
		const { getArgs } = setup();

		await Effect.runPromise(unlock(config, { organizationId: "org-1", removeAll: true }, mockDeps));

		expect(getArgs()).toContain("--remove-all");
	});

	test("returns a typed lock error for restic lock failures", async () => {
		setup();
		vi.spyOn(nodeModule, "safeExec").mockResolvedValueOnce({
			exitCode: 11,
			stdout: "",
			stderr: "unable to create lock in backend: repository is already locked",
			timedOut: false,
		});

		const error = await Effect.runPromise(Effect.flip(unlock(config, { organizationId: "org-1" }, mockDeps)));
		expect(error).toBeInstanceOf(ResticLockError);
	});
});
