import { mkdtemp, mkdir, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { afterEach, expect, test, vi } from "vitest";
import { loadConfiguration, readConfiguration, writeConfiguration } from "../config";
import { runTest } from "./effect-test-support";

const directories: string[] = [];

afterEach(async () => {
	vi.unstubAllEnvs();
	await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

const setup = async () => {
	const directory = await mkdtemp(path.join(tmpdir(), "zerobyte-config-"));
	directories.push(directory);

	return { directory, configPath: path.join(directory, "config", "agent.json") };
};

const saved = {
	controllerUrl: "wss://controller.example/api/v1/agents/connect",
	token: "saved-private-credential",
	roots: [{ id: "documents", label: "Documents", path: "/srv/documents", allowBackup: true }],
	controllerSessionId: "preserved-unknown-field",
};

test("a written configuration is private, complete, and leaves no staging files", async () => {
	const { configPath } = await setup();

	await runTest(writeConfiguration(configPath, saved));

	expect(await runTest(readConfiguration(configPath))).toEqual(saved);
	expect((await stat(configPath)).mode & 0o777).toBe(0o600);
	expect(await readdir(path.dirname(configPath))).toEqual(["agent.json"]);
});

test("missing, malformed, and invalid files give distinct recovery messages without exposing the credential", async () => {
	const { configPath } = await setup();

	await expect(runTest(readConfiguration(configPath))).rejects.toMatchObject({ _tag: "ConfigurationMissing" });

	await mkdir(path.dirname(configPath));
	await writeFile(configPath, '{"token":"saved-private-credential"');
	const malformed = await runTest(readConfiguration(configPath)).catch((error: Error) => error.message);
	expect(malformed).toContain(configPath);
	expect(malformed).toContain("valid JSON");
	expect(malformed).not.toContain("saved-private-credential");

	await writeFile(
		configPath,
		JSON.stringify({ ...saved, roots: [{ id: "documents", label: "Documents", path: 42 }] }),
	);
	const invalid = await runTest(readConfiguration(configPath)).catch((error: Error) => error.message);
	expect(invalid).toContain("roots.0.path");
	expect(invalid).not.toContain("saved-private-credential");
});

test.each([undefined, "[]"])("loads the saved configuration with roots override %s", async (roots) => {
	const { configPath } = await setup();
	await runTest(writeConfiguration(configPath, saved));
	vi.stubEnv("ZEROBYTE_CONTROLLER_URL", undefined);
	vi.stubEnv("ZEROBYTE_AGENT_TOKEN", undefined);
	vi.stubEnv("ZEROBYTE_AGENT_ROOTS", roots);

	await expect(runTest(loadConfiguration(configPath))).resolves.toEqual({
		...saved,
		roots: roots === undefined ? saved.roots : [],
		configPath,
	});
});

test("environment credentials take precedence over the configuration file", async () => {
	vi.stubEnv("ZEROBYTE_CONTROLLER_URL", "ws://127.0.0.1:4096/api/v1/agents/connect");
	vi.stubEnv("ZEROBYTE_AGENT_TOKEN", "environment-token");
	vi.stubEnv("ZEROBYTE_AGENT_ROOTS", undefined);

	await expect(runTest(loadConfiguration("/missing/agent.json"))).resolves.toEqual({
		controllerUrl: "ws://127.0.0.1:4096/api/v1/agents/connect",
		token: "environment-token",
		roots: [],
	});
});

test.each([
	"ws://remote.example/api/v1/agents/connect",
	"http://remote.example/api/v1/agents/connect",
	"ws://localhost.example/api/v1/agents/connect",
	"ws://127.0.0.1.example/api/v1/agents/connect",
	"ws://[::2]/api/v1/agents/connect",
])("rejects an insecure non-loopback environment controller URL %s", async (controllerUrl) => {
	vi.stubEnv("ZEROBYTE_CONTROLLER_URL", controllerUrl);
	vi.stubEnv("ZEROBYTE_AGENT_TOKEN", "secret-token");

	await expect(runTest(loadConfiguration("/missing/agent.json"))).rejects.toThrow("must use wss://");
});

test.each(["ws://localhost/api/v1/agents/connect", "ws://[::1]:4096/api/v1/agents/connect", "wss://remote.example"])(
	"accepts a secure or loopback environment controller URL %s",
	async (controllerUrl) => {
		vi.stubEnv("ZEROBYTE_CONTROLLER_URL", controllerUrl);
		vi.stubEnv("ZEROBYTE_AGENT_TOKEN", "token");

		await expect(runTest(loadConfiguration("/missing/agent.json"))).resolves.toMatchObject({ controllerUrl });
	},
);

test.each(["http://remote.example", "ws://remote.example/api/v1/agents/connect"])(
	"allows an insecure controller %s only with explicit environment opt-in",
	async (controllerUrl) => {
		vi.stubEnv("ZEROBYTE_CONTROLLER_URL", controllerUrl);
		vi.stubEnv("ZEROBYTE_AGENT_TOKEN", "secret-token");

		for (const value of [undefined, "false", "1", "TRUE"]) {
			vi.stubEnv("ZEROBYTE_AGENT_ALLOW_INSECURE_HTTP", value);
			await expect(runTest(loadConfiguration("/missing/agent.json"))).rejects.toThrow(
				"ZEROBYTE_AGENT_ALLOW_INSECURE_HTTP=true",
			);
		}

		vi.stubEnv("ZEROBYTE_AGENT_ALLOW_INSECURE_HTTP", "true");

		await expect(runTest(loadConfiguration("/missing/agent.json"))).resolves.toMatchObject({
			controllerUrl: "ws://remote.example/api/v1/agents/connect",
		});
	},
);

test("converts an HTTPS controller address into a secure WebSocket endpoint", async () => {
	vi.stubEnv("ZEROBYTE_CONTROLLER_URL", "https://remote.example");
	vi.stubEnv("ZEROBYTE_AGENT_TOKEN", "secret-token");

	await expect(runTest(loadConfiguration("/missing/agent.json"))).resolves.toMatchObject({
		controllerUrl: "wss://remote.example/api/v1/agents/connect",
	});
});

test.each(["ftp://remote.example", "http://user:password@remote.example"])(
	"insecure HTTP opt-in does not allow invalid controller URL %s",
	async (controllerUrl) => {
		vi.stubEnv("ZEROBYTE_CONTROLLER_URL", controllerUrl);
		vi.stubEnv("ZEROBYTE_AGENT_TOKEN", "secret-token");
		vi.stubEnv("ZEROBYTE_AGENT_ALLOW_INSECURE_HTTP", "true");

		await expect(runTest(loadConfiguration("/missing/agent.json"))).rejects.toThrow("without embedded credentials");
	},
);
