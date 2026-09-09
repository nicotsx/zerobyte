import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, expect, test } from "vitest";

const binary = process.env.AGENT_BINARY;
let directory: string;
beforeEach(async () => {
	directory = await mkdtemp(join(tmpdir(), "zerobyte-cli-"));
});
afterEach(async () => {
	await rm(directory, { recursive: true, force: true });
});

const run = (args: string[], env: NodeJS.ProcessEnv = {}) =>
	spawnSync(
		binary ?? process.execPath,
		binary ? args : [fileURLToPath(new URL("../index.ts", import.meta.url)), ...args],
		{
			cwd: directory,
			encoding: "utf8",
			timeout: 10_000,
			env: {
				PATH: "/usr/bin:/bin",
				HOME: directory,
				NO_COLOR: "1",
				RESTIC_COMMAND: join(directory, "missing-restic"),
				ZEROBYTE_AGENT_VERSION: binary ? "runtime-override" : "dev",
				...env,
			},
		},
	);

test("help and enrollment help work without Restic or configuration", () => {
	const help = run(["--help"]);
	expect(help.status).toBe(0);
	expect(help.stdout).toContain("Usage: zerobyte-agent");
	expect(help.stdout).toContain("check");
	expect(help.stdout).toContain("install");
	expect(help.stdout).toContain("update");
	const enroll = run(["enroll", "--help"]);
	expect(enroll.status).toBe(0);
	expect(enroll.stdout).toContain("--no-start");
	expect(enroll.stdout).toContain("--root <folders...>");
	const install = run(["install", "--help"]);
	expect(install.status).toBe(0);
	expect(install.stdout).toContain("Install or upgrade the Linux systemd service");
	const update = run(["update", "--help"]);
	expect(update.status).toBe(0);
	expect(update.stdout).toContain("--version <version>");
});

test("version works without prerequisites and compiled releases retain their build version", () => {
	const result = run(["--version"]);
	expect(result.status).toBe(0);
	expect(result.stdout.trim()).toBe(binary ? (process.env.ZEROBYTE_AGENT_VERSION ?? "dev") : "dev");
});

test.each([
	{ args: ["unknown"], error: "unknown" },
	{ args: ["enroll"], error: "required option '--controller <url>'" },
	{
		args: ["logs", "--lines", "-1"],
		error: "positive whole number",
	},
	{ args: ["--no-start"], error: "unknown option '--no-start'" },
])("rejects invalid arguments before checking prerequisites: $args", ({ args, error }) => {
	const result = run(args);
	expect(result.status).toBe(1);
	expect(result.stderr).toContain(error);
	expect(result.stderr).not.toContain("Cannot run Restic");
});

test.each(["start", "check", "enroll"])(
	"missing Restic stops %s with configuration exit status before saving an identity",
	(command) => {
		const config = join(directory, "agent.json");
		const args =
			command === "start"
				? ["--config", config]
				: command === "check"
					? ["check"]
					: [
							"enroll",
							"--controller",
							"https://controller.example",
							"--code",
							"unused-code",
							"--root",
							directory,
							"--config",
							config,
							"--no-start",
						];
		const result = run(args);
		expect(result.status).toBe(78);
		expect(result.stderr).toContain("Install Restic 0.18.0 or newer");
		expect(existsSync(config)).toBe(false);
	},
);

test.skipIf(!binary)("compiled agents ignore dotenv and bunfig files in their working directory", async () => {
	await writeFile(join(directory, ".env"), "RESTIC_COMMAND=/dotenv-autoloaded-restic\n");
	await writeFile(join(directory, "bunfig.toml"), 'preload = ["./preload.ts"]\n');
	await writeFile(join(directory, "preload.ts"), "process.exit(42);\n");
	const result = run(["--version"]);
	expect(result.status).toBe(0);
	expect(result.stdout.trim()).toBe(process.env.ZEROBYTE_AGENT_VERSION ?? "dev");
	const check = run(["check"], { PATH: directory, RESTIC_COMMAND: undefined });
	expect(check.status).toBe(78);
	expect(check.stderr).toContain("Cannot run Restic (restic)");
});
