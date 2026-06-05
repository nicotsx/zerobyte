import { afterEach, describe, expect, test, vi } from "vitest";
import * as cleanupModule from "../../helpers/cleanup-temporary-keys";
import * as nodeModule from "../../../node";
import { forget } from "../forget";
import type { ResticDeps } from "../../types";
import { Effect } from "effect";

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
	vi.spyOn(cleanupModule, "cleanupTemporaryKeys").mockImplementation(() => Promise.resolve());
	vi.spyOn(nodeModule, "safeExec").mockImplementation(async () => {
		return { exitCode: 0, stdout: "", stderr: "", timedOut: false };
	});
};

afterEach(() => {
	vi.restoreAllMocks();
});

describe("forget command", () => {
	test("does not treat a cleanup-time abort as a failed successful forget", async () => {
		const controller = new AbortController();
		setup();
		vi.spyOn(cleanupModule, "cleanupTemporaryKeys").mockImplementation(async () => {
			controller.abort(new Error("aborted during cleanup"));
		});

		const result = await Effect.runPromise(
			forget(
				config,
				{ keepLast: 1 },
				{ organizationId: "org-1", tag: "daily", signal: controller.signal },
				mockDeps,
			),
		);

		expect(result).toEqual({ success: true, data: null });
		expect(cleanupModule.cleanupTemporaryKeys).toHaveBeenCalledTimes(1);
	});
});
