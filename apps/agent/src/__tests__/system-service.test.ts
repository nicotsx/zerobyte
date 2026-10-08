import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test, vi } from "vitest";
import { installSystemService, SERVICE_PATH, type InstallOptions } from "../system-service";
import { commandFailure, createTestHost, runTest } from "./effect-test-support";

const temporaryDirectories: string[] = [];

const machineToken = (agentId: string, version: number) =>
	`zba1.${agentId}.${version}.${Buffer.alloc(32, version).toString("base64url")}`;

const savedIdentity = {
	controllerUrl: "wss://controller.example/api/v1/agents/connect",
	token: machineToken("existing-machine", 1),
	roots: [{ id: "stable-folder-id", label: "Data", path: "/srv/data", allowBackup: false }],
	controllerSessionId: "original-session",
};

afterEach(async () => {
	vi.unstubAllGlobals();
	await Promise.all(
		temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
	);
});

const setup = async () => {
	const directory = await mkdtemp(join(tmpdir(), "zerobyte-service-"));
	temporaryDirectories.push(directory);

	const paths = {
		installDir: join(directory, "bin"),
		stateDir: join(directory, "state"),
		serviceDir: join(directory, "systemd"),
	};
	const files = {
		binary: join(paths.installDir, "zerobyte-agent"),
		unit: join(paths.serviceDir, "zerobyte-agent.service"),
		config: join(paths.stateDir, "agent.json"),
	};
	const sourceBinary = join(directory, "downloaded-agent");
	const folder = join(directory, "files");

	await writeFile(sourceBinary, "native-agent-v2", { mode: 0o755 });
	await mkdir(folder);

	const exchange = vi.fn(async () => Response.json({ token: machineToken("existing-machine", 3) }));
	vi.stubGlobal("fetch", exchange);

	const host = createTestHost();
	const install = (options: Partial<InstallOptions> = {}, testHost = host) =>
		runTest(installSystemService({ roots: [], sourceBinary, paths, ...options }), testHost);

	return { folder, paths, files, exchange, host, install };
};

type Fixture = Awaited<ReturnType<typeof setup>>;

const withExistingInstallation = async ({ paths, files }: Fixture) => {
	await Promise.all(Object.values(paths).map((path) => mkdir(path, { recursive: true })));
	await writeFile(files.binary, "native-agent-v1", { mode: 0o755 });
	await writeFile(files.unit, "previous-unit-definition", { mode: 0o644 });
	await writeFile(files.config, JSON.stringify(savedIdentity), { mode: 0o600 });
};

const readConfig = async ({ files }: Fixture) => JSON.parse(await readFile(files.config, "utf8"));

const expectUntouched = async (fixture: Fixture) => {
	expect(await readConfig(fixture)).toEqual(savedIdentity);
	expect(await readFile(fixture.files.binary, "utf8")).toBe("native-agent-v1");
	expect(await readFile(fixture.files.unit, "utf8")).toBe("previous-unit-definition");
};

const expectNoStagingLeftovers = async ({ paths }: Fixture) => {
	expect(await readdir(paths.installDir)).toEqual(["zerobyte-agent"]);
	expect(await readdir(paths.serviceDir)).toEqual(["zerobyte-agent.service"]);
	expect(await readdir(paths.stateDir)).toEqual(["agent.json"]);
};

const failOn = (fixture: Fixture, matches: (command: string, args: ReadonlyArray<string>) => boolean) => {
	const host = createTestHost();
	host.output.mockImplementation((command, args) =>
		matches(command, args) ? commandFailure("service unavailable") : fixture.host.output(command, args),
	);

	return host;
};

test.each([false, true])(
	"initial installation enrolls and starts the service (with folders: %s)",
	async (withFolders) => {
		const fixture = await setup();
		await fixture.install({
			controller: new URL("https://controller.example"),
			code: machineToken("existing-machine", 2),
			roots: withFolders ? [fixture.folder] : [],
		});

		expect(await readConfig(fixture)).toEqual({
			controllerUrl: savedIdentity.controllerUrl,
			token: machineToken("existing-machine", 3),
			roots: withFolders ? [expect.objectContaining({ path: fixture.folder, allowBackup: true })] : [],
		});
		expect(await readFile(fixture.files.binary, "utf8")).toBe("native-agent-v2");
		expect((await stat(fixture.files.binary)).mode & 0o777).toBe(0o755);
		expect((await stat(fixture.files.config)).mode & 0o777).toBe(0o600);
		expect((await stat(fixture.paths.stateDir)).mode & 0o777).toBe(0o700);

		const unit = await readFile(fixture.files.unit, "utf8");
		expect(unit).toContain(`ExecStart=${fixture.files.binary} run --config ${fixture.files.config}`);
		expect(unit).toContain(`Environment=PATH=${SERVICE_PATH}`);
		expect(unit).toContain("Restart=on-failure");
		expect(unit).not.toContain("RestartPreventExitStatus");
		expect(fixture.host.output).toHaveBeenCalledWith("systemctl", ["restart", "zerobyte-agent.service"]);
		await expectNoStagingLeftovers(fixture);
	},
);

test("initial installation requires a controller and a code", async () => {
	const fixture = await setup();

	await expect(fixture.install({ code: machineToken("existing-machine", 2) })).rejects.toThrow(
		"Initial installation requires --controller and --code",
	);
	expect(fixture.exchange).not.toHaveBeenCalled();
});

test("upgrade replaces the executable and preserves identity without exchanging a code", async () => {
	const fixture = await setup();
	await withExistingInstallation(fixture);

	await fixture.install();

	expect(fixture.exchange).not.toHaveBeenCalled();
	expect(await readConfig(fixture)).toEqual(savedIdentity);
	expect(await readFile(fixture.files.binary, "utf8")).toBe("native-agent-v2");
	await expectNoStagingLeftovers(fixture);
});

test("a connection code reconnects the saved machine and preserves its folders", async () => {
	const fixture = await setup();
	await withExistingInstallation(fixture);

	await fixture.install({ code: machineToken("existing-machine", 2) });

	expect(await readConfig(fixture)).toEqual({ ...savedIdentity, token: machineToken("existing-machine", 3) });
	expect((await stat(fixture.files.config)).mode & 0o777).toBe(0o600);
	expect(fixture.exchange).toHaveBeenCalledWith(
		new URL("https://controller.example/api/v1/agents/enroll"),
		expect.anything(),
	);
	await expectNoStagingLeftovers(fixture);
});

test("a controller address without a code relocates the agent and keeps its credential", async () => {
	const fixture = await setup();
	await withExistingInstallation(fixture);

	await fixture.install({ controller: new URL("https://controller.example:9443") });

	expect(await readConfig(fixture)).toEqual({
		...savedIdentity,
		controllerUrl: "wss://controller.example:9443/api/v1/agents/connect",
	});
	expect(fixture.exchange).not.toHaveBeenCalled();
});

test.each([
	{ code: machineToken("another-machine", 2) },
	{ code: "not-a-code" },
	{ code: machineToken("existing-machine", 2), roots: ["/new-folder"] },
])("an invalid reconnection leaves the installation untouched: %j", async (options) => {
	const fixture = await setup();
	await withExistingInstallation(fixture);

	await expect(fixture.install(options)).rejects.toThrow();
	expect(fixture.exchange).not.toHaveBeenCalled();
	await expectUntouched(fixture);
	await expectNoStagingLeftovers(fixture);
});

test.each([401, 503])("a rejected reconnection (%s) leaves the installation untouched", async (status) => {
	const fixture = await setup();
	await withExistingInstallation(fixture);
	fixture.exchange.mockImplementation(async () => Response.json({ message: "Enrollment rejected" }, { status }));

	await expect(fixture.install({ code: machineToken("existing-machine", 2) })).rejects.toThrow(
		`Enrollment failed (${status})`,
	);
	await expectUntouched(fixture);
	await expectNoStagingLeftovers(fixture);
});

test.each(["", "truncated", "{}"])(
	"a malformed saved identity is preserved and does not consume a code: %j",
	async (contents) => {
		const fixture = await setup();
		await withExistingInstallation(fixture);
		await writeFile(fixture.files.config, contents);

		await expect(
			fixture.install({
				controller: new URL("https://controller.example"),
				code: machineToken("existing-machine", 2),
			}),
		).rejects.toThrow("agent configuration");
		expect(fixture.exchange).not.toHaveBeenCalled();
		expect(await readFile(fixture.files.config, "utf8")).toBe(contents);
	},
);

test.each([
	{
		step: "the Restic prerequisite",
		matches: (_command: string, args: ReadonlyArray<string>) => args[0] === "version",
	},
	{
		step: "the staged executable",
		matches: (_command: string, args: ReadonlyArray<string>) => args[0] === "--version",
	},
	{
		step: "systemd detection",
		matches: (_command: string, args: ReadonlyArray<string>) => args[0] === "show-environment",
	},
])("a failure in $step leaves the connection code available for retry", async ({ matches }) => {
	const fixture = await setup();
	const options = { controller: new URL("https://controller.example"), code: machineToken("existing-machine", 2) };

	await expect(fixture.install(options, failOn(fixture, matches))).rejects.toThrow();
	expect(fixture.exchange).not.toHaveBeenCalled();

	await fixture.install(options);
	expect(fixture.exchange).toHaveBeenCalledOnce();
});

test.each(["daemon-reload", "enable", "restart"])(
	"a failed %s activation is repaired by retrying without a code",
	async (step) => {
		const fixture = await setup();
		await withExistingInstallation(fixture);

		await expect(
			fixture.install(
				{ code: machineToken("existing-machine", 2) },
				failOn(fixture, (command, args) => command === "systemctl" && args[0] === step),
			),
		).rejects.toThrow("run install again without --code");

		const replacement = { ...savedIdentity, token: machineToken("existing-machine", 3) };
		expect(await readConfig(fixture)).toEqual(replacement);

		await fixture.install();
		expect(fixture.exchange).toHaveBeenCalledOnce();
		expect(await readConfig(fixture)).toEqual(replacement);
		await expectNoStagingLeftovers(fixture);
	},
);
