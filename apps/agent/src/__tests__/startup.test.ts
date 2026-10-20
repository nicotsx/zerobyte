import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, test, vi } from "vitest";
import { readConfiguration, writeConfiguration } from "../config";
import { loadStartupConfiguration } from "../startup";
import { runTest } from "./effect-test-support";

const directories: string[] = [];
const code = "zba1.machine.0.enrollment-secret";
const token = "zba1.machine.1.machine-secret";

afterEach(async () => {
	vi.unstubAllEnvs();
	vi.unstubAllGlobals();
	await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

const setup = async () => {
	const directory = await mkdtemp(path.join(tmpdir(), "zerobyte-startup-"));
	directories.push(directory);
	vi.stubEnv("ZEROBYTE_AGENT_TOKEN", undefined);
	vi.stubEnv("ZEROBYTE_AGENT_ENROLLMENT_CODE", code);
	vi.stubEnv("ZEROBYTE_CONTROLLER_URL", "https://controller.example");
	vi.stubEnv("ZEROBYTE_AGENT_ROOTS", undefined);

	const roots = [{ id: "documents", label: "Documents", path: directory, allowBackup: false }];
	const configuration = { controllerUrl: "wss://controller.example/api/v1/agents/connect", token, roots };
	const request = vi.fn(async () => Response.json({ token }));
	vi.stubGlobal("fetch", request);

	return { directory, configPath: path.join(directory, "config", "agent.json"), roots, configuration, request };
};

test("first startup exchanges the enrollment code and persists a private machine credential and allowed locations", async () => {
	const { configPath, roots, request } = await setup();
	vi.stubEnv("ZEROBYTE_AGENT_ROOTS", JSON.stringify(roots));

	const configuration = await runTest(loadStartupConfiguration(configPath));

	expect(configuration).toMatchObject({ token, roots, configPath });
	expect(await runTest(readConfiguration(configPath))).toMatchObject({ token, roots });
	expect((await stat(path.dirname(configPath))).mode & 0o777).toBe(0o700);
	expect((await stat(configPath)).mode & 0o777).toBe(0o600);
	expect(await readFile(configPath, "utf8")).not.toContain(code);
	expect(request).toHaveBeenCalledOnce();
});

test("startup preserves the permissions of an existing configuration directory", async () => {
	const { configPath } = await setup();
	const configDirectory = path.dirname(configPath);
	await mkdir(configDirectory);
	await chmod(configDirectory, 0o755);

	await runTest(loadStartupConfiguration(configPath));

	expect((await stat(configDirectory)).mode & 0o777).toBe(0o755);
	expect((await stat(configPath)).mode & 0o777).toBe(0o600);
});

test("restarting with a consumed enrollment code reuses the saved credential without another exchange", async () => {
	const { configPath, configuration, request } = await setup();
	await runTest(writeConfiguration(configPath, configuration));

	await expect(runTest(loadStartupConfiguration(configPath))).resolves.toMatchObject(configuration);
	expect(request).not.toHaveBeenCalled();
});

test("the enrollment code can be removed after startup", async () => {
	const { configPath, configuration, request } = await setup();
	await runTest(writeConfiguration(configPath, configuration));
	vi.stubEnv("ZEROBYTE_AGENT_ENROLLMENT_CODE", undefined);

	await expect(runTest(loadStartupConfiguration(configPath))).resolves.toMatchObject(configuration);
	expect(request).not.toHaveBeenCalled();
});

test("a fresh code reconnects the same machine while preserving its allowed locations and extra configuration", async () => {
	const { configPath, configuration, request } = await setup();
	await runTest(writeConfiguration(configPath, { ...configuration, extra: "preserved" }));
	vi.stubEnv("ZEROBYTE_AGENT_ENROLLMENT_CODE", "zba1.machine.2.reconnection-secret");
	vi.stubGlobal(
		"fetch",
		request.mockImplementation(async () => Response.json({ token: "zba1.machine.3.new-secret" })),
	);

	const updated = await runTest(loadStartupConfiguration(configPath));

	expect(updated).toMatchObject({
		token: "zba1.machine.3.new-secret",
		roots: configuration.roots,
		extra: "preserved",
	});
	expect(await runTest(readConfiguration(configPath))).toMatchObject({
		token: "zba1.machine.3.new-secret",
		roots: configuration.roots,
		extra: "preserved",
	});
	expect(request).toHaveBeenCalledOnce();
});

test("a code for a different machine cannot replace the saved identity", async () => {
	const { configPath, configuration, request } = await setup();
	await runTest(writeConfiguration(configPath, configuration));
	vi.stubEnv("ZEROBYTE_AGENT_ENROLLMENT_CODE", "zba1.other-machine.2.other-secret");

	await expect(runTest(loadStartupConfiguration(configPath))).rejects.toThrow("different machine");
	expect(await runTest(readConfiguration(configPath))).toEqual(configuration);
	expect(request).not.toHaveBeenCalled();
});

test.each(["invalid JSON", '[{"id":"missing","label":"Missing","path":"/definitely/missing"}]'])(
	"invalid allowed locations fail before consuming the code: %s",
	async (roots) => {
		const { configPath, request } = await setup();
		vi.stubEnv("ZEROBYTE_AGENT_ROOTS", roots);

		await expect(runTest(loadStartupConfiguration(configPath))).rejects.toBeInstanceOf(Error);
		expect(request).not.toHaveBeenCalled();
	},
);

test("malformed saved configuration is preserved without consuming a fresh code", async () => {
	const { configPath, configuration, request } = await setup();
	await runTest(writeConfiguration(configPath, configuration));
	await writeFile(configPath, "invalid configuration");

	await expect(runTest(loadStartupConfiguration(configPath))).rejects.toThrow("not valid JSON");
	expect(await readFile(configPath, "utf8")).toBe("invalid configuration");
	expect(request).not.toHaveBeenCalled();
});

test("HTTP enrollment requires an explicit development flag", async () => {
	const { configPath, request } = await setup();
	vi.stubEnv("ZEROBYTE_CONTROLLER_URL", "http://controller.example");

	await expect(runTest(loadStartupConfiguration(configPath))).rejects.toThrow("HTTPS controller URL");
	expect(request).not.toHaveBeenCalled();
	await expect(runTest(loadStartupConfiguration(configPath, true))).resolves.toMatchObject({
		controllerUrl: "ws://controller.example/api/v1/agents/connect",
	});
});

test("ambiguous environment credentials fail before enrollment", async () => {
	const { configPath, request } = await setup();
	vi.stubEnv("ZEROBYTE_AGENT_TOKEN", token);

	await expect(runTest(loadStartupConfiguration(configPath))).rejects.toThrow("not both");
	expect(request).not.toHaveBeenCalled();
});
