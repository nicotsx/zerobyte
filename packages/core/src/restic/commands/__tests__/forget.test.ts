import { Effect } from "effect";
import { afterEach, expect, test, vi } from "vitest";
import * as nodeModule from "../../../node";
import type { ResticDeps } from "../../types";
import { forget } from "../forget";

afterEach(() => {
	vi.restoreAllMocks();
});

test("passes the retention window to Restic's forget command", async () => {
	const exec = vi.spyOn(nodeModule, "safeExec").mockResolvedValue({
		exitCode: 0,
		stdout: "[]",
		stderr: "",
		timedOut: false,
	});

	const deps: ResticDeps = {
		resolveSecret: async (secret) => secret,
		getOrganizationResticPassword: async () => "test-password",
		resticCacheDir: "/tmp/restic-cache",
		resticPassFile: "/tmp/restic.pass",
		defaultExcludes: [],
		rcloneConfigFile: "/tmp/rclone.conf",
	};

	await Effect.runPromise(
		forget(
			{ backend: "local", path: "/tmp/restic-repo" },
			{ keepWithinDuration: "7d" },
			{ organizationId: "org-1", tag: "schedule-1", dryRun: true },
			deps,
		),
	);

	const args = exec.mock.calls[0]?.[0].args ?? [];
	const flagIndex = args.indexOf("--keep-within");

	expect(flagIndex).toBeGreaterThanOrEqual(0);
	expect(args[flagIndex + 1]).toBe("7d");
});
