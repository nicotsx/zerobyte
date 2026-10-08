import { mkdtemp, mkdir, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { afterEach, expect, test, vi } from "vitest";
import { enrollAgent } from "../enrollment";

const directories: string[] = [];
afterEach(async () => {
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
	expect(JSON.parse(configuration.roots)[0].path).toBe(options.roots[0]);
	const persisted = await readFile(options.configPath, "utf8");
	expect(persisted).toContain("machine-credential");
	expect(persisted).not.toContain("one-time-code");
	expect((await stat(options.configPath)).mode & 0o777).toBe(0o600);
	await expect(enrollAgent(options)).rejects.toThrow();
	expect(request).toHaveBeenCalledTimes(1);
});

test("failed enrollment removes the reserved file so a fresh code can be used", async () => {
	const options = await setup();
	vi.stubGlobal(
		"fetch",
		vi.fn(async () => new Response("Unauthorized", { status: 401 })),
	);
	await expect(enrollAgent(options)).rejects.toThrow("Enrollment failed (401)");
	await expect(stat(options.configPath)).rejects.toThrow();
});

test("plaintext enrollment is rejected before transmitting the code", async () => {
	const options = await setup();
	const request = vi.fn();
	vi.stubGlobal("fetch", request);
	await expect(enrollAgent({ ...options, controller: "http://controller.example" })).rejects.toThrow("HTTPS");
	expect(request).not.toHaveBeenCalled();
});
