import { mkdtemp, mkdir, readFile, readdir, rm, stat, symlink, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { afterEach, expect, test, vi } from "vitest";
import { configureAgent, enrollAgent } from "../enrollment";
import { program } from "../index";

vi.mock("node:child_process", async (importOriginal) => {
	const { promisify } = await import("node:util");
	return {
		...(await importOriginal<typeof import("node:child_process")>()),
		execFile: Object.assign(vi.fn(), {
			[promisify.custom]: async () => ({
				stdout: "restic 0.18.0 compiled with go1.24.0 on linux/amd64",
				stderr: "",
			}),
		}),
	};
});

const directories: string[] = [];
afterEach(async () => {
	vi.unstubAllGlobals();
	vi.unstubAllEnvs();
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

test("failed enrollment releases its reservation so a fresh code can be used", async () => {
	const options = await setup();
	const request = vi
		.fn()
		.mockResolvedValueOnce(Response.json({ message: "TLS required" }, { status: 426 }))
		.mockResolvedValueOnce(Response.json({ token: "fresh-credential" }));
	vi.stubGlobal("fetch", request);

	await expect(enrollAgent(options)).rejects.toThrow("Enrollment failed (426): TLS required");
	await expect(stat(options.configPath)).rejects.toMatchObject({ code: "ENOENT" });
	expect(await readdir(path.dirname(options.configPath))).toEqual([]);

	await enrollAgent({ ...options, code: "fresh-code" });

	expect(JSON.parse(await readFile(options.configPath, "utf8")).token).toBe("fresh-credential");
	expect(request).toHaveBeenCalledTimes(2);
});

test("pending enrollment keeps the identity absent and excludes competing enrollment", async () => {
	const options = await setup();
	const request = vi.fn(async () => {
		await expect(stat(options.configPath)).rejects.toMatchObject({ code: "ENOENT" });
		await expect(enrollAgent({ ...options, code: "competing-code" })).rejects.toThrow();
		return Response.json({ token: "winning-credential" });
	});
	vi.stubGlobal("fetch", request);

	const configuration = await enrollAgent(options);

	expect(request).toHaveBeenCalledOnce();
	expect(JSON.parse(await readFile(options.configPath, "utf8"))).toEqual(configuration);
	expect(configuration.token).toBe("winning-credential");
	expect(await readdir(path.dirname(options.configPath))).toEqual(["agent.json"]);
});

test("publication never overwrites an identity created during the exchange", async () => {
	const options = await setup();
	const existing = JSON.stringify({ controllerUrl: "wss://existing.example", token: "existing", roots: "[]" });
	vi.stubGlobal(
		"fetch",
		vi.fn(async () => {
			await writeFile(options.configPath, existing);
			return Response.json({ token: "new-credential" });
		}),
	);

	await expect(enrollAgent(options)).rejects.toThrow();

	expect(await readFile(options.configPath, "utf8")).toBe(existing);
	expect(await readdir(path.dirname(options.configPath))).toEqual(["agent.json"]);
});

test.each(["", "{", '{"token":"existing"}'])("an existing configuration is never replaced: %j", async (existing) => {
	const options = await setup();
	await mkdir(path.dirname(options.configPath));
	await writeFile(options.configPath, existing);
	const request = vi.fn();
	vi.stubGlobal("fetch", request);

	await expect(enrollAgent(options)).rejects.toThrow();

	expect(request).not.toHaveBeenCalled();
	expect(await readFile(options.configPath, "utf8")).toBe(existing);
});

test("a dangling configuration symlink prevents enrollment without creating its target", async () => {
	const options = await setup();
	await mkdir(path.dirname(options.configPath));
	const target = path.join(path.dirname(options.configPath), "missing.json");
	await symlink(target, options.configPath);
	const request = vi.fn();
	vi.stubGlobal("fetch", request);

	await expect(enrollAgent(options)).rejects.toThrow();

	expect(request).not.toHaveBeenCalled();
	await expect(stat(target)).rejects.toMatchObject({ code: "ENOENT" });
});

test("an abandoned reservation does not prevent enrollment with a fresh code", async () => {
	const options = await setup();
	const reservation = `${options.configPath}.lock`;
	await mkdir(reservation, { recursive: true });
	const abandoned = `${options.configPath}.interrupted.tmp`;
	await writeFile(abandoned, '{"token":', { mode: 0o600 });
	const stale = new Date(Date.now() - 60_000);
	await utimes(reservation, stale, stale);
	const request = vi.fn(async () => Response.json({ token: "recovered-credential" }));
	vi.stubGlobal("fetch", request);

	const configuration = await enrollAgent(options);

	expect(request).toHaveBeenCalledOnce();
	expect(JSON.parse(await readFile(options.configPath, "utf8"))).toEqual(configuration);
	await expect(stat(reservation)).rejects.toMatchObject({ code: "ENOENT" });
	expect(await readFile(abandoned, "utf8")).toBe('{"token":');
});

test("plaintext enrollment is rejected before transmitting the code", async () => {
	const options = await setup();
	const request = vi.fn();
	vi.stubGlobal("fetch", request);
	await expect(enrollAgent({ ...options, controller: "http://controller.example" })).rejects.toThrow("HTTPS");
	expect(request).not.toHaveBeenCalled();
});

test("service enrollment saves the identity and returns without starting a foreground agent", async () => {
	const options = await setup();
	vi.stubGlobal(
		"fetch",
		vi.fn(async () => Response.json({ token: "machine-credential" })),
	);
	for (const key of [
		"ZEROBYTE_BUILTIN_LOCAL_AGENT",
		"ZEROBYTE_AGENT_CONFIG_PATH",
		"ZEROBYTE_AGENT_ALLOW_INSECURE",
		"ZEROBYTE_CONTROLLER_URL",
		"ZEROBYTE_AGENT_TOKEN",
		"ZEROBYTE_AGENT_ROOTS",
	]) {
		vi.stubEnv(key, undefined);
	}
	const connect = vi.fn();
	vi.stubGlobal("WebSocket", connect);
	await program.parseAsync(
		[
			"enroll",
			"--controller",
			options.controller,
			"--code",
			options.code,
			"--root",
			options.roots[0]!,
			"--root",
			path.dirname(options.roots[0]!),
			"--config",
			options.configPath,
			"--no-start",
		],
		{ from: "user" },
	);
	const configuration = JSON.parse(await readFile(options.configPath, "utf8"));
	expect(configuration.token).toBe("machine-credential");
	expect(JSON.parse(configuration.roots).map((root: { path: string }) => root.path)).toEqual([
		options.roots[0],
		path.dirname(options.roots[0]!),
	]);
	expect(connect).not.toHaveBeenCalled();
	await configureAgent(options.configPath);
	expect(process.env.ZEROBYTE_AGENT_CONFIG_PATH).toBe(options.configPath);
	expect(process.env.ZEROBYTE_AGENT_TOKEN).toBe("machine-credential");
});

test("explicit development enrollment persists HTTP permission across restarts", async () => {
	const options = await setup();
	vi.stubGlobal(
		"fetch",
		vi.fn(async () => Response.json({ token: "dev-machine" })),
	);
	for (const key of [
		"ZEROBYTE_BUILTIN_LOCAL_AGENT",
		"ZEROBYTE_AGENT_CONFIG_PATH",
		"ZEROBYTE_CONTROLLER_URL",
		"ZEROBYTE_AGENT_TOKEN",
		"ZEROBYTE_AGENT_ROOTS",
		"ZEROBYTE_AGENT_ALLOW_INSECURE",
	])
		vi.stubEnv(key, undefined);
	const configuration = await enrollAgent({
		...options,
		controller: "http://192.168.1.10:8080",
		allowInsecure: true,
	});
	expect(configuration.controllerUrl).toBe("ws://192.168.1.10:8080/api/v1/agents/connect");
	expect(JSON.parse(await readFile(options.configPath, "utf8")).allowInsecure).toBe(true);
	await configureAgent(options.configPath);
	expect(process.env.ZEROBYTE_AGENT_ALLOW_INSECURE).toBe("1");
});

test("a machine can enroll without granting access to any folders", async () => {
	const { roots: _roots, ...options } = await setup();
	vi.stubGlobal(
		"fetch",
		vi.fn(async () => Response.json({ token: "machine-credential" })),
	);
	const configuration = await enrollAgent(options);
	expect(JSON.parse(configuration.roots)).toEqual([]);
	expect(JSON.parse(await readFile(options.configPath, "utf8")).roots).toBe("[]");
});
