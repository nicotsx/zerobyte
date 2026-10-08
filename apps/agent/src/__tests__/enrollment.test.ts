import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { afterEach, expect, test, vi } from "vitest";
import { configureAgent, enrollAgent } from "../enrollment";

const directories: string[] = [];
const originalArguments = process.argv;

afterEach(async () => {
	process.argv = originalArguments;
	vi.unstubAllEnvs();
	vi.unstubAllGlobals();
	await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

const setup = async () => {
	const directory = await mkdtemp(path.join(tmpdir(), "zerobyte-enrollment-"));
	directories.push(directory);

	const root = path.join(directory, "files");

	await mkdir(root);

	return {
		controller: "https://controller.example",
		code: "one-time-code",
		roots: [root],
		configPath: path.join(directory, "config", "agent.json"),
	};
};

test("enrollment persists a private machine credential and explicit roots", async () => {
	const options = await setup();
	const request = vi.fn(async () => Response.json({ token: "machine-credential" }));

	vi.stubGlobal("fetch", request);

	const configuration = await enrollAgent(options);

	expect(configuration.controllerUrl).toBe("wss://controller.example/api/v1/agents/connect");
	expect(configuration.roots[0]?.path).toBe(options.roots[0]);

	const persisted = await readFile(options.configPath, "utf8");

	expect(persisted).toContain("machine-credential");
	expect(persisted).not.toContain("one-time-code");
	expect((await stat(options.configPath)).mode & 0o777).toBe(0o600);

	await expect(enrollAgent(options)).rejects.toThrow();
	expect(request).toHaveBeenCalledTimes(1);
});

test("failed enrollment leaves no saved configuration so a fresh code can be used", async () => {
	const options = await setup();

	vi.stubGlobal(
		"fetch",
		vi.fn(async () => new Response("Unauthorized", { status: 401 })),
	);

	await expect(enrollAgent(options)).rejects.toThrow("Enrollment failed (401)");
	await expect(stat(options.configPath)).rejects.toThrow();
});

test("directory errors leave the one-time code unconsumed", async () => {
	const options = await setup();
	const request = vi.fn();

	await writeFile(path.dirname(options.configPath), "blocked");
	vi.stubGlobal("fetch", request);

	await expect(enrollAgent(options)).rejects.toThrow();
	expect(request).not.toHaveBeenCalled();
});

test("plaintext enrollment is rejected before transmitting the code", async () => {
	const options = await setup();
	const request = vi.fn();

	vi.stubGlobal("fetch", request);

	await expect(enrollAgent({ ...options, controller: "http://controller.example" })).rejects.toThrow("HTTPS");
	expect(request).not.toHaveBeenCalled();
});

test("invalid machine credentials do not leave a saved configuration", async () => {
	const options = await setup();

	vi.stubGlobal(
		"fetch",
		vi.fn(async () => Response.json({ token: null })),
	);

	await expect(enrollAgent(options)).rejects.toThrow("invalid machine credential");
	await expect(stat(options.configPath)).rejects.toThrow();
});

test.each([undefined, "{", JSON.stringify({ token: "machine-credential" })])(
	"a missing or invalid saved configuration asks the user to enroll: %j",
	async (contents) => {
		const options = await setup();

		if (contents !== undefined) {
			await mkdir(path.dirname(options.configPath));
			await writeFile(options.configPath, contents);
		}

		vi.stubEnv("ZEROBYTE_BUILTIN_LOCAL_AGENT", "0");
		vi.stubEnv("ZEROBYTE_CONTROLLER_URL", undefined);
		vi.stubEnv("ZEROBYTE_AGENT_TOKEN", undefined);
		vi.stubEnv("ZEROBYTE_AGENT_ROOTS", undefined);
		process.argv = [process.execPath, "agent", "--config", options.configPath];

		await expect(configureAgent()).rejects.toThrow(
			"Invalid agent configuration. Enroll this machine from the Zerobyte controller.",
		);
	},
);

test.each([undefined, "[]"])(
	"loads the saved configuration with roots override %s without changing the environment",
	async (roots) => {
		const options = await setup();

		vi.stubGlobal(
			"fetch",
			vi.fn(async () => Response.json({ token: "machine-credential" })),
		);

		const saved = await enrollAgent(options);

		vi.stubEnv("ZEROBYTE_BUILTIN_LOCAL_AGENT", "0");
		vi.stubEnv("ZEROBYTE_CONTROLLER_URL", undefined);
		vi.stubEnv("ZEROBYTE_AGENT_TOKEN", undefined);
		vi.stubEnv("ZEROBYTE_AGENT_ROOTS", roots);
		process.argv = [process.execPath, "agent", "--config", options.configPath];

		await expect(configureAgent()).resolves.toEqual({
			...saved,
			roots: roots === undefined ? saved.roots : [],
			configPath: path.resolve(options.configPath),
		});
		expect(process.env.ZEROBYTE_CONTROLLER_URL).toBeUndefined();
		expect(process.env.ZEROBYTE_AGENT_TOKEN).toBeUndefined();
		expect(process.env.ZEROBYTE_AGENT_ROOTS).toBe(roots);
	},
);
