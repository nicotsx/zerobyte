import { chmod, mkdir, readFile, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { afterEach, expect, test, vi } from "vitest";
import { installSystemService, SERVICE_PATH } from "../system-service";

const temporaryDirectories: string[] = [];
const savedIdentity = JSON.stringify({
	controllerUrl: "wss://controller.example/api/v1/agents/connect",
	token: "existing-credential",
	roots: "[]",
});

afterEach(async () => {
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
	const sourceBinary = join(directory, "downloaded-agent");
	await writeFile(sourceBinary, "native-agent-v1", { mode: 0o755 });
	const commands: string[][] = [];
	const runCommand = vi.fn(async (command: string, args: string[]) => {
		commands.push([command, ...args]);
	});
	const checkPrerequisite = vi.fn(async () => "0.18.0");
	const enroll = vi.fn(async (options: { configPath: string }) => {
		const configuration = {
			controllerUrl: "wss://controller.example/api/v1/agents/connect",
			token: "token",
			roots: "[]",
		};
		await writeFile(options.configPath, JSON.stringify(configuration), { mode: 0o600 });

		return configuration;
	});
	return { directory, paths, sourceBinary, commands, runCommand, checkPrerequisite, enroll };
};

test.each([undefined, ["/srv/data"]])(
	"initial installation enrolls and starts the background service with folders %j",
	async (roots) => {
		const fixture = await setup();
		const result = await installSystemService(
			{ controller: "https://controller.example", code: "zba1-code", roots },
			{
				paths: fixture.paths,
				sourceBinary: fixture.sourceBinary,
				platform: "linux",
				uid: 0,
				runCommand: fixture.runCommand,
				checkPrerequisite: fixture.checkPrerequisite,
				enroll: fixture.enroll,
			},
		);

		expect(result.enrolled).toBe(true);
		expect(fixture.checkPrerequisite).toHaveBeenCalledOnce();
		expect(fixture.enroll).toHaveBeenCalledWith({
			controller: "https://controller.example",
			code: "zba1-code",
			roots: roots ?? [],
			configPath: join(fixture.paths.stateDir, "agent.json"),
			allowInsecure: undefined,
		});
		expect(await readFile(result.binary, "utf8")).toBe("native-agent-v1");
		expect((await stat(result.binary)).mode & 0o777).toBe(0o755);
		expect((await stat(result.config)).mode & 0o777).toBe(0o600);
		expect((await stat(fixture.paths.stateDir)).mode & 0o777).toBe(0o700);
		expect(await readFile(result.unit, "utf8")).toContain(
			`ExecStart=${result.binary} run --config ${result.config}`,
		);
		expect(await readFile(result.unit, "utf8")).toContain(`Environment=PATH=${SERVICE_PATH}`);
		expect(fixture.commands).toEqual([
			["getconf", "GNU_LIBC_VERSION"],
			["systemctl", "show-environment"],
			["systemctl", "daemon-reload"],
			["systemctl", "enable", "zerobyte-agent.service"],
			["systemctl", "restart", "zerobyte-agent.service"],
		]);
	},
);

test("upgrade preserves the identity while replacing the executable and service definition", async () => {
	const fixture = await setup();
	await mkdir(fixture.paths.stateDir, { recursive: true });
	const config = join(fixture.paths.stateDir, "agent.json");
	await writeFile(config, savedIdentity, { mode: 0o600 });
	await chmod(fixture.sourceBinary, 0o755);
	const result = await installSystemService(
		{},
		{
			paths: fixture.paths,
			sourceBinary: fixture.sourceBinary,
			platform: "linux",
			uid: 0,
			runCommand: fixture.runCommand,
			checkPrerequisite: fixture.checkPrerequisite,
			enroll: fixture.enroll,
		},
	);

	expect(result.enrolled).toBe(false);
	expect(fixture.enroll).not.toHaveBeenCalled();
	expect(await readFile(config, "utf8")).toBe(savedIdentity);
	expect(await readFile(result.binary, "utf8")).toBe("native-agent-v1");
	expect(fixture.commands.at(-1)).toEqual(["systemctl", "restart", "zerobyte-agent.service"]);
});

test("an existing identity rejects enrollment arguments before changing the installation", async () => {
	const fixture = await setup();
	await mkdir(fixture.paths.stateDir, { recursive: true });
	await writeFile(join(fixture.paths.stateDir, "agent.json"), savedIdentity, { mode: 0o600 });

	await expect(
		installSystemService(
			{ controller: "https://controller.example", code: "new-code", roots: ["/srv/data"] },
			{
				paths: fixture.paths,
				sourceBinary: fixture.sourceBinary,
				platform: "linux",
				uid: 0,
				runCommand: fixture.runCommand,
				checkPrerequisite: fixture.checkPrerequisite,
				enroll: fixture.enroll,
			},
		),
	).rejects.toThrow("already enrolled");
	expect(fixture.checkPrerequisite).not.toHaveBeenCalled();
	expect(fixture.enroll).not.toHaveBeenCalled();
});

test.each([
	"",
	"truncated",
	"{}",
	'{"token":"existing"}',
	'{"token":"existing","controllerUrl":"wss://controller.example"}',
	'{"token":"existing","controllerUrl":"wss://controller.example","roots":[]}',
	'{"token":123,"controllerUrl":"wss://controller.example","roots":"[]"}',
])("a malformed existing identity requires attention instead of being declared enrolled: %j", async (existing) => {
	const fixture = await setup();
	await mkdir(fixture.paths.stateDir, { recursive: true });
	await writeFile(join(fixture.paths.stateDir, "agent.json"), existing);

	await expect(
		installSystemService(
			{},
			{
				paths: fixture.paths,
				sourceBinary: fixture.sourceBinary,
				platform: "linux",
				uid: 0,
				runCommand: fixture.runCommand,
				checkPrerequisite: fixture.checkPrerequisite,
				enroll: fixture.enroll,
			},
		),
	).rejects.toThrow("Invalid agent configuration");

	expect(fixture.enroll).not.toHaveBeenCalled();
	expect(fixture.checkPrerequisite).not.toHaveBeenCalled();
	expect(await readFile(join(fixture.paths.stateDir, "agent.json"), "utf8")).toBe(existing);
	await expect(stat(join(fixture.paths.installDir, "zerobyte-agent"))).rejects.toMatchObject({ code: "ENOENT" });
	expect(fixture.commands).toEqual([
		["getconf", "GNU_LIBC_VERSION"],
		["systemctl", "show-environment"],
	]);
});

test.each(["truncated", "{}", '{"token":"existing","controllerUrl":"wss://controller.example"}'])(
	"unattended enrollment arguments alongside a broken identity do not consume the code: %j",
	async (existing) => {
		const fixture = await setup();
		await mkdir(fixture.paths.stateDir, { recursive: true });
		await writeFile(join(fixture.paths.stateDir, "agent.json"), existing);
		const enroll = vi.fn();

		await expect(
			installSystemService(
				{ controller: "https://controller.example", code: "fresh-code" },
				{
					paths: fixture.paths,
					sourceBinary: fixture.sourceBinary,
					platform: "linux",
					uid: 0,
					runCommand: fixture.runCommand,
					checkPrerequisite: fixture.checkPrerequisite,
					enroll,
				},
			),
		).rejects.toThrow("Invalid agent configuration");
		expect(enroll).not.toHaveBeenCalled();
	},
);

test("installation refuses a symbolic-link state directory", async () => {
	const fixture = await setup();
	const target = join(fixture.directory, "redirected-state");
	await mkdir(target);
	await symlink(target, fixture.paths.stateDir);

	await expect(
		installSystemService(
			{ controller: "https://controller.example", code: "code", roots: ["/srv/data"] },
			{
				paths: fixture.paths,
				sourceBinary: fixture.sourceBinary,
				platform: "linux",
				uid: 0,
				runCommand: fixture.runCommand,
			},
		),
	).rejects.toThrow("must not be symbolic links");
});
