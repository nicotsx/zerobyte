import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";

test.each([
	{ output: "", exit: 0, hang: false },
	{ output: "https://installer.zerobyte.localhost:1355", exit: 1, hang: false },
	{ output: "", exit: 0, hang: true },
])(
	"deployment exits before SSH when portless get produces $output with exit $exit and hang=$hang",
	async ({ output, exit, hang }) => {
		const directory = await mkdtemp(join(tmpdir(), "zerobyte-dev-deploy-"));

		try {
			await writeFile(
				join(directory, "portless"),
				`#!/usr/bin/env bun\n${hang ? "setInterval(() => {}, 1000);" : `console.log(${JSON.stringify(output)}); process.exit(${exit});`}\n`,
				{ mode: 0o755 },
			);
			await writeFile(join(directory, "ssh"), "#!/bin/sh\necho SSH_MUST_NOT_RUN >&2\nexit 1\n", { mode: 0o755 });

			const result = spawnSync(
				process.execPath,
				[fileURLToPath(new URL("../../../../scripts/deploy-dev-agent.ts", import.meta.url)), "user@server"],
				{ encoding: "utf8", timeout: 15_000, env: { ...process.env, PATH: directory } },
			);

			expect(result.status).toBe(1);
			expect(result.stderr).toContain("Could not resolve the running Zerobyte controller from Portless");
			expect(result.stderr).not.toContain("SSH_MUST_NOT_RUN");
			expect(result.stdout).not.toContain("Building");
		} finally {
			await rm(directory, { recursive: true, force: true });
		}
	},
	15_000,
);
