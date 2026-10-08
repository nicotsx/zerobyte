import { execFile } from "node:child_process";
import { chmod, mkdir, readFile, readdir, rename, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { mkdtemp, rm } from "node:fs/promises";
import { afterEach, expect, test, vi } from "vitest";
import { installSystemService, SERVICE_PATH } from "../system-service";
import { enrollAgent } from "../enrollment";

const temporaryDirectories: string[] = [];
const machineToken = (agentId: string, version: number, secretByte = 1) =>
	`zba1.${Buffer.from(agentId).toString("base64url")}.${version}.${Buffer.alloc(32, secretByte).toString("base64url")}`;

const savedIdentity = JSON.stringify({
	controllerUrl: "wss://controller.example/api/v1/agents/connect",
	token: machineToken("existing-machine", 1),
	roots: "[]",
});

test("reconnect rejects a code for a different machine on the same controller before consuming it", async () => {
	const fixture = await setup();
	const previous = await existingInstallation(fixture);
	const identity = {
		...JSON.parse(savedIdentity),
		token: machineToken("existing-machine", 1),
		roots: '[{"id":"stable-folder-id","label":"Data","path":"/srv/data","allowBackup":false}]',
		controllerSessionId: "original-session",
	};
	const originalConfig = JSON.stringify(identity);
	await writeFile(previous.config, originalConfig, { mode: 0o600 });
	const exchange = vi.fn(async () => Response.json({ token: machineToken("new-machine", 3) }));
	vi.stubGlobal("fetch", exchange);

	await expect(
		installSystemService(
			{ controller: "https://controller.example", code: machineToken("new-machine", 2), reconnect: true },
			{ ...installerDependencies(fixture), enroll: enrollAgent },
		),
	).rejects.toThrow(/different machine.*Settings → Machines.*Actions/);

	expect(exchange).not.toHaveBeenCalled();
	expect(await readFile(previous.config, "utf8")).toBe(originalConfig);
	expect(await readFile(previous.binary, "utf8")).toBe("previous-native-agent");
	expect(await readFile(previous.unit, "utf8")).toBe("previous-unit-definition");
	expect(await readdir(fixture.paths.stateDir)).toEqual(["agent.json"]);
});

afterEach(async () => {
	vi.unstubAllGlobals();
	await Promise.all(
		temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
	);
});

test("explicit reconnect exchanges a code atomically and preserves folder IDs, allowances, and connection settings", async () => {
	const fixture = await setup();
	const previous = await existingInstallation(fixture);
	const roots = JSON.stringify([
		{ id: "documents-uuid", label: "Documents", path: "/srv/documents", allowBackup: true },
		{ id: "blocked-uuid", label: "Private", path: "/srv/private", allowBackup: false },
	]);
	const identity = {
		...JSON.parse(savedIdentity),
		roots,
		controllerSessionId: "saved-session",
		allowInsecure: false,
	};
	await writeFile(previous.config, JSON.stringify(identity), { mode: 0o600 });
	vi.stubGlobal("fetch", async (url: URL, init: RequestInit) => {
		expect(url.toString()).toBe("https://controller.example/api/v1/agents/enroll");
		if (typeof init.body !== "string") throw new Error("Expected an enrollment request body");
		expect(JSON.parse(init.body)).toEqual({ code: machineToken("existing-machine", 2, 2) });
		expect(JSON.parse(await readFile(previous.config, "utf8"))).toEqual(identity);
		return Response.json({ token: machineToken("existing-machine", 3, 3) });
	});

	const result = await installSystemService(
		{ controller: "https://controller.example", code: machineToken("existing-machine", 2, 2), reconnect: true },
		{ ...installerDependencies(fixture), enroll: enrollAgent },
	);

	expect(result.reconnected).toBe(true);
	expect(JSON.parse(await readFile(previous.config, "utf8"))).toEqual({
		...identity,
		token: machineToken("existing-machine", 3, 3),
	});
	expect((await stat(previous.config)).mode & 0o777).toBe(0o600);
	expect(await readdir(fixture.paths.stateDir)).toEqual(["agent.json"]);
	expect(fixture.commands.at(-1)).toEqual(["systemctl", "restart", "zerobyte-agent.service"]);
});

test("failed reconnect exchange leaves the installed identity and artifacts intact", async () => {
	const fixture = await setup();
	const previous = await existingInstallation(fixture);
	vi.stubGlobal("fetch", async () => Response.json({ message: "Connection code expired" }, { status: 401 }));

	await expect(
		installSystemService(
			{ code: machineToken("existing-machine", 2, 4), reconnect: true },
			{ ...installerDependencies(fixture), enroll: enrollAgent },
		),
	).rejects.toThrow("Connection code expired");

	expect(await readFile(previous.config, "utf8")).toBe(savedIdentity);
	expect(await readFile(previous.binary, "utf8")).toBe("previous-native-agent");
	expect(await readFile(previous.unit, "utf8")).toBe("previous-unit-definition");
	expect(await readdir(fixture.paths.stateDir)).toEqual(["agent.json"]);
});

test("activation failure retains the new reconnect identity and folders for retry without a consumed code", async () => {
	const fixture = await setup();
	const previous = await existingInstallation(fixture);
	const identity = {
		...JSON.parse(savedIdentity),
		roots: '[{"id":"stable-id","label":"Data","path":"/srv/data","allowBackup":false}]',
	};
	await writeFile(previous.config, JSON.stringify(identity), { mode: 0o600 });
	const exchange = vi.fn(async () => Response.json({ token: machineToken("existing-machine", 3, 3) }));
	vi.stubGlobal("fetch", exchange);
	const runCommand = async (command: string, args: string[]) => {
		if (args[0] === "restart") throw new Error("service activation failed");
		return fixture.runCommand(command, args);
	};

	await expect(
		installSystemService(
			{ code: machineToken("existing-machine", 2, 2), reconnect: true },
			{ ...installerDependencies(fixture), enroll: enrollAgent, runCommand },
		),
	).rejects.toThrow("Run install without --code to retry");

	const replacement = JSON.parse(await readFile(previous.config, "utf8"));
	expect(replacement).toMatchObject({ ...identity, token: machineToken("existing-machine", 3, 3) });
	expect(await readFile(previous.binary, "utf8")).toBe("previous-native-agent");
	await installSystemService({}, { ...installerDependencies(fixture), enroll: enrollAgent });

	expect(exchange).toHaveBeenCalledOnce();
	expect(JSON.parse(await readFile(previous.config, "utf8"))).toEqual(replacement);
	expect(await readFile(previous.binary, "utf8")).toBe("native-agent-v1");
});

test.each([
	{ reconnect: true },
	{ reconnect: true, code: "code", roots: ["/new-folder"] },
	{ reconnect: true, code: "code", controller: "https://other-controller.example" },
])("invalid reconnect options are rejected before consuming a code: %j", async (options) => {
	const fixture = await setup();
	const previous = await existingInstallation(fixture);

	await expect(installSystemService(options, installerDependencies(fixture))).rejects.toThrow();

	expect(fixture.enroll).not.toHaveBeenCalled();
	expect(fixture.checkPrerequisite).not.toHaveBeenCalled();
	expect(await readFile(previous.config, "utf8")).toBe(savedIdentity);
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
		if (args[0] === "is-enabled") return "disabled";
		if (args[0] === "is-active") return "inactive";
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
		expect(fixture.commands.slice(0, 2)).toEqual([
			["getconf", "GNU_LIBC_VERSION"],
			["systemctl", "show-environment"],
		]);
		expect(fixture.commands[2]?.[1]).toBe("--version");
		expect(fixture.commands.slice(3)).toEqual([
			["systemctl", "is-enabled", "zerobyte-agent.service"],
			["systemctl", "is-active", "zerobyte-agent.service"],
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

test("upgrade refreshes the controller port while preserving credentials and shared folders", async () => {
	const fixture = await setup();
	const previous = await existingInstallation(fixture);
	const identity = { ...JSON.parse(savedIdentity), roots: '[{"id":"data","label":"Data","path":"/srv/data"}]' };
	await writeFile(previous.config, JSON.stringify(identity), { mode: 0o600 });

	const result = await installSystemService(
		{ controller: "https://controller.example:9443" },
		installerDependencies(fixture),
	);

	expect(JSON.parse(await readFile(result.config, "utf8"))).toMatchObject({
		...identity,
		controllerUrl: "wss://controller.example:9443/api/v1/agents/connect",
	});
	expect((await stat(result.config)).mode & 0o777).toBe(0o600);
	expect(fixture.enroll).not.toHaveBeenCalled();
	expect(fixture.commands.at(-1)).toEqual(["systemctl", "restart", "zerobyte-agent.service"]);
});

test("failed activation restores the saved controller address before restarting the previous installation", async () => {
	const fixture = await setup();
	const previous = await existingInstallation(fixture);
	let failed = false;
	const runCommand = async (command: string, args: string[]) => {
		if (args[0] === "is-active") return "active";
		if (args[0] === "restart") {
			const identity = JSON.parse(await readFile(previous.config, "utf8"));
			if (!failed) {
				expect(identity.controllerUrl).toBe("wss://controller.example:9443/api/v1/agents/connect");
				failed = true;
				throw new Error("activation failed");
			}
			expect(identity.controllerUrl).toBe(JSON.parse(savedIdentity).controllerUrl);
		}

		return fixture.runCommand(command, args);
	};

	await expect(
		installSystemService(
			{ controller: "https://controller.example:9443" },
			{ ...installerDependencies(fixture), runCommand },
		),
	).rejects.toThrow("activation failed");

	expect(failed).toBe(true);
	expect(await readFile(previous.config, "utf8")).toBe(savedIdentity);
	expect(await readFile(previous.binary, "utf8")).toBe("previous-native-agent");
	expect(await readdir(fixture.paths.stateDir)).toEqual(["agent.json"]);
});

test.each(["http://controller.example", "https://user:secret@controller.example", "wss://controller.example"])(
	"upgrade rejects an unsafe controller address before changing the installation: %s",
	async (controller) => {
		const fixture = await setup();
		const previous = await existingInstallation(fixture);

		await expect(installSystemService({ controller }, installerDependencies(fixture))).rejects.toThrow(
			"HTTPS controller URL",
		);

		expect(await readFile(previous.config, "utf8")).toBe(savedIdentity);
		expect(await readFile(previous.binary, "utf8")).toBe("previous-native-agent");
		expect(fixture.checkPrerequisite).not.toHaveBeenCalled();
	},
);

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

const installerDependencies = (fixture: Awaited<ReturnType<typeof setup>>) => ({
	paths: fixture.paths,
	sourceBinary: fixture.sourceBinary,
	platform: "linux" as const,
	uid: 0,
	runCommand: fixture.runCommand,
	checkPrerequisite: fixture.checkPrerequisite,
	enroll: fixture.enroll,
});

const existingInstallation = async (fixture: Awaited<ReturnType<typeof setup>>) => {
	await Promise.all(Object.values(fixture.paths).map((path) => mkdir(path, { recursive: true })));
	const binary = join(fixture.paths.installDir, "zerobyte-agent");
	const unit = join(fixture.paths.serviceDir, "zerobyte-agent.service");
	const config = join(fixture.paths.stateDir, "agent.json");

	await writeFile(binary, "previous-native-agent", { mode: 0o750 });
	await writeFile(unit, "previous-unit-definition", { mode: 0o640 });
	await writeFile(config, savedIdentity, { mode: 0o600 });

	return { binary, unit, config };
};

test("staging failure leaves the enrollment code unconsumed", async () => {
	const fixture = await setup();
	await rm(fixture.sourceBinary);

	await expect(
		installSystemService(
			{ controller: "https://controller.example", code: "one-time-code" },
			installerDependencies(fixture),
		),
	).rejects.toMatchObject({ code: "ENOENT" });

	expect(fixture.enroll).not.toHaveBeenCalled();
	await expect(stat(join(fixture.paths.stateDir, "agent.json"))).rejects.toMatchObject({ code: "ENOENT" });
});

test("the second publication failure restores the previous executable and retains its identity", async () => {
	const fixture = await setup();
	const previous = await existingInstallation(fixture);
	let publications = 0;
	const renameFile = async (source: Parameters<typeof rename>[0], target: Parameters<typeof rename>[1]) => {
		publications += 1;
		if (publications === 2) throw new Error("unit publication failed");
		await rename(source, target);
	};

	await expect(installSystemService({}, { ...installerDependencies(fixture), renameFile })).rejects.toThrow(
		"unit publication failed",
	);

	expect(await readFile(previous.binary, "utf8")).toBe("previous-native-agent");
	expect(await readFile(previous.unit, "utf8")).toBe("previous-unit-definition");
	expect(await readFile(previous.config, "utf8")).toBe(savedIdentity);
	expect((await stat(previous.binary)).mode & 0o777).toBe(0o750);
	expect(fixture.enroll).not.toHaveBeenCalled();
	expect(fixture.commands.some(([, operation]) => operation === "restart")).toBe(false);
	expect(await readdir(fixture.paths.installDir)).toEqual(["zerobyte-agent"]);
	expect(await readdir(fixture.paths.serviceDir)).toEqual(["zerobyte-agent.service"]);
});

test.each(
	["daemon-reload", "enable", "restart"].flatMap((failure) =>
		[true, false].flatMap((enabled) => [true, false].map((active) => ({ failure, enabled, active }))),
	),
)(
	"$failure failure restores prior enabled=$enabled active=$active service and artifacts",
	async ({ failure, enabled, active }) => {
		const fixture = await setup();
		const previous = await existingInstallation(fixture);
		let currentEnabled = enabled;
		let currentActive = active;
		let failed = false;
		const runCommand = async (command: string, args: string[]) => {
			if (command !== "systemctl") return;
			const operation = args[0];
			if (operation === "is-enabled") return currentEnabled ? "enabled" : "disabled";
			if (operation === "is-active") return currentActive ? "active" : "inactive";
			if (operation === "enable") currentEnabled = true;
			if (operation === "disable") currentEnabled = false;
			if (operation === "restart") currentActive = true;
			if (operation === "stop") currentActive = false;
			if (operation === failure && !failed) {
				failed = true;
				throw new Error(`${failure} failed after its external effect`);
			}
		};

		await expect(installSystemService({}, { ...installerDependencies(fixture), runCommand })).rejects.toThrow(
			`${failure} failed`,
		);

		expect(await readFile(previous.binary, "utf8")).toBe("previous-native-agent");
		expect(await readFile(previous.unit, "utf8")).toBe("previous-unit-definition");
		expect((await stat(previous.binary)).mode & 0o777).toBe(0o750);
		expect((await stat(previous.unit)).mode & 0o777).toBe(0o640);
		expect(await readFile(previous.config, "utf8")).toBe(savedIdentity);
		expect(currentEnabled).toBe(enabled);
		expect(currentActive).toBe(active);
		expect(await readdir(fixture.paths.installDir)).toEqual(["zerobyte-agent"]);
		expect(await readdir(fixture.paths.serviceDir)).toEqual(["zerobyte-agent.service"]);
	},
);

test("a failed initial activation can retry with the saved machine identity", async () => {
	const fixture = await setup();
	let failed = false;
	const runCommand = async (command: string, args: string[]) => {
		const status = await fixture.runCommand(command, args);
		if (args[0] === "restart" && !failed) {
			failed = true;
			throw new Error("initial restart failed");
		}
		return status;
	};
	const dependencies = { ...installerDependencies(fixture), runCommand };

	await expect(
		installSystemService({ controller: "https://controller.example", code: "one-time-code" }, dependencies),
	).rejects.toThrow("initial restart failed");

	const config = join(fixture.paths.stateDir, "agent.json");
	const enrolledIdentity = await readFile(config, "utf8");
	expect(fixture.enroll).toHaveBeenCalledOnce();
	expect(await readdir(fixture.paths.installDir)).toEqual([]);
	expect(await readdir(fixture.paths.serviceDir)).toEqual([]);

	const result = await installSystemService({}, dependencies);

	expect(result.enrolled).toBe(false);
	expect(fixture.enroll).toHaveBeenCalledOnce();
	expect(await readFile(config, "utf8")).toBe(enrolledIdentity);
	expect(await readFile(result.binary, "utf8")).toBe("native-agent-v1");
});

test("rollback failure reports both errors and retains original artifacts for manual recovery", async () => {
	const fixture = await setup();
	const previous = await existingInstallation(fixture);
	const renameFile = async (source: Parameters<typeof rename>[0], target: Parameters<typeof rename>[1]) => {
		if (target === previous.binary && (await readFile(source, "utf8")) === "previous-native-agent") {
			throw new Error("binary restoration failed");
		}
		await rename(source, target);
	};
	const runCommand = async (command: string, args: string[]) => {
		if (args[0] === "daemon-reload") throw new Error("daemon reload failed");
		return fixture.runCommand(command, args);
	};

	const error = await installSystemService({}, { ...installerDependencies(fixture), runCommand, renameFile }).catch(
		(failure: unknown) => failure,
	);

	expect(error).toBeInstanceOf(AggregateError);
	if (!(error instanceof AggregateError)) throw new Error("Expected recovery errors");

	expect(error.message).toContain("rollback was incomplete");
	expect(error.message).toContain("binary restoration failed");
	expect(error.message).toContain("daemon reload failed");
	expect(error.errors.map((failure: Error) => failure.message)).toContain("binary restoration failed");
	expect(error.errors.map((failure: Error) => failure.message)).toContain("daemon reload failed");
	const binaryBackup = (await readdir(fixture.paths.installDir)).find((name) => name.endsWith(".previous"));
	const unitBackup = (await readdir(fixture.paths.serviceDir)).find((name) => name.endsWith(".previous"));
	if (!binaryBackup || !unitBackup) throw new Error("Expected recovery artifacts to remain available");

	expect(await readFile(join(fixture.paths.installDir, binaryBackup), "utf8")).toBe("previous-native-agent");
	expect(await readFile(join(fixture.paths.serviceDir, unitBackup), "utf8")).toBe("previous-unit-definition");
	expect(error.message).toContain(binaryBackup);
	expect(error.message).toContain(unitBackup);
	expect(await readFile(previous.config, "utf8")).toBe(savedIdentity);
});

test.each(["masked", "static", "enabled-runtime", "indirect"])(
	"unsupported prior %s state is rejected before enrollment or publication",
	async (state) => {
		const fixture = await setup();
		const previous = await existingInstallation(fixture);
		const runCommand = async (command: string, args: string[]) => {
			if (args[0] === "is-enabled") return state;
			return fixture.runCommand(command, args);
		};

		await expect(installSystemService({}, { ...installerDependencies(fixture), runCommand })).rejects.toThrow(
			"Unsupported prior service state",
		);

		expect(await readFile(previous.binary, "utf8")).toBe("previous-native-agent");
		expect(await readFile(previous.unit, "utf8")).toBe("previous-unit-definition");
		expect(fixture.enroll).not.toHaveBeenCalled();
	},
);

test.each([1, 4])(
	"absent-unit is-enabled exit %s permits installation while unexpected failures do not consume enrollment",
	async (missingUnitExit) => {
		const fixture = await setup();
		const runCommand = async (command: string, args: string[]) => {
			if (args[0] === "is-enabled")
				throw Object.assign(new Error("not found"), {
					code: missingUnitExit,
					stdout: "",
					stderr: "Failed to get unit file state: No such file or directory",
				});
			if (args[0] === "is-active") throw Object.assign(new Error("inactive"), { code: 3, stdout: "inactive\n" });
			return fixture.runCommand(command, args);
		};

		await installSystemService(
			{ controller: "https://controller.example", code: "code" },
			{ ...installerDependencies(fixture), runCommand },
		);
		expect(fixture.enroll).toHaveBeenCalledOnce();

		const broken = await setup();
		const brokenCommand = async (command: string, args: string[]) => {
			if (args[0] === "is-enabled") throw Object.assign(new Error("bus unavailable"), { code: 5 });
			return broken.runCommand(command, args);
		};

		await expect(
			installSystemService(
				{ controller: "https://controller.example", code: "code" },
				{ ...installerDependencies(broken), runCommand: brokenCommand },
			),
		).rejects.toThrow("bus unavailable");
		expect(broken.enroll).not.toHaveBeenCalled();
	},
);

test("a competing process cannot publish or roll back an installation owned by another installer", async () => {
	const fixture = await setup();
	const previous = await existingInstallation(fixture);
	const staged = Promise.withResolvers<void>();
	const continueInstallation = Promise.withResolvers<void>();
	const runCommand = async (command: string, args: string[]) => {
		if (args[0] === "--version") {
			staged.resolve();
			await continueInstallation.promise;
		}

		return fixture.runCommand(command, args);
	};

	const firstInstallation = installSystemService({}, { ...installerDependencies(fixture), runCommand });

	try {
		await staged.promise;
		const competingSource = join(fixture.directory, "competing-agent");
		await writeFile(competingSource, "competing-native-agent", { mode: 0o755 });
		const installerModule = new URL("../system-service.ts", import.meta.url).pathname;
		const script = `
			import { installSystemService } from ${JSON.stringify(installerModule)};
			try {
				await installSystemService({}, {
					paths: ${JSON.stringify(fixture.paths)},
					sourceBinary: ${JSON.stringify(competingSource)},
					platform: "linux",
					uid: 0,
					checkPrerequisite: async () => {},
					runCommand: async (command, args) => {
						if (args[0] === "is-enabled") return "disabled";
						if (args[0] === "is-active") return "inactive";
						if (args[0] === "restart") throw new Error("competing activation failed");
					},
				});
				process.exit(2);
			} catch (error) {
				console.error(error.code ?? error.message);
				process.exit(1);
			}
		`;

		await expect(promisify(execFile)(process.execPath, ["--eval", script])).rejects.toMatchObject({
			code: 1,
			stderr: expect.stringContaining("ELOCKED"),
		});
		expect(await readFile(previous.binary, "utf8")).toBe("previous-native-agent");
		expect(await readFile(previous.unit, "utf8")).toBe("previous-unit-definition");
	} finally {
		continueInstallation.resolve();
		await firstInstallation;
	}

	expect(await readFile(previous.binary, "utf8")).toBe("native-agent-v1");
	const installedUnit = await readFile(previous.unit, "utf8");
	await writeFile(fixture.sourceBinary, "native-agent-v2", { mode: 0o755 });

	const runFailingCommand = async (command: string, args: string[]) => {
		if (args[0] === "restart") throw new Error("later activation failed");
		return fixture.runCommand(command, args);
	};

	await expect(
		installSystemService({}, { ...installerDependencies(fixture), runCommand: runFailingCommand }),
	).rejects.toThrow("later activation failed");

	expect(await readFile(previous.binary, "utf8")).toBe("native-agent-v1");
	expect(await readFile(previous.unit, "utf8")).toBe(installedUnit);
	expect(await readFile(previous.config, "utf8")).toBe(savedIdentity);

	await installSystemService({}, installerDependencies(fixture));
	expect(await readFile(previous.binary, "utf8")).toBe("native-agent-v2");
	expect(await readdir(fixture.paths.installDir)).toEqual(["zerobyte-agent"]);
	expect(await readdir(fixture.paths.serviceDir)).toEqual(["zerobyte-agent.service"]);
});

test("installation releases ownership after rejecting the saved identity", async () => {
	const fixture = await setup();
	const previous = await existingInstallation(fixture);
	await writeFile(previous.config, "broken identity");

	await expect(installSystemService({}, installerDependencies(fixture))).rejects.toThrow(
		"Invalid agent configuration",
	);

	await writeFile(previous.config, savedIdentity, { mode: 0o600 });
	await installSystemService({}, installerDependencies(fixture));

	expect(await readFile(previous.binary, "utf8")).toBe("native-agent-v1");
	expect(await readFile(previous.config, "utf8")).toBe(savedIdentity);
});

test("failed reconnect publication retains a private replacement configuration with the original folder IDs", async () => {
	const fixture = await setup();
	const previous = await existingInstallation(fixture);
	const identity = {
		...JSON.parse(savedIdentity),
		roots: '[{"id":"retained-id","label":"Data","path":"/srv/data","allowBackup":false}]',
	};
	await writeFile(previous.config, JSON.stringify(identity), { mode: 0o600 });
	vi.stubGlobal("fetch", async () => Response.json({ token: machineToken("existing-machine", 3, 5) }));
	const renameFile = async (source: Parameters<typeof rename>[0], target: Parameters<typeof rename>[1]) => {
		if (target === previous.config) throw new Error("configuration publication failed");
		await rename(source, target);
	};

	await expect(
		installSystemService(
			{ code: machineToken("existing-machine", 2, 2), reconnect: true },
			{ ...installerDependencies(fixture), enroll: enrollAgent, renameFile },
		),
	).rejects.toThrow("replacement identity. It is retained at");

	expect(JSON.parse(await readFile(previous.config, "utf8"))).toEqual(identity);
	const recoveryFile = (await readdir(fixture.paths.stateDir)).find((entry) => entry.endsWith(".tmp"));
	if (!recoveryFile) throw new Error("Expected a retained replacement identity");
	const recoveryPath = join(fixture.paths.stateDir, recoveryFile);
	expect(JSON.parse(await readFile(recoveryPath, "utf8"))).toMatchObject({
		...identity,
		token: machineToken("existing-machine", 3, 5),
	});
	expect((await stat(recoveryPath)).mode & 0o777).toBe(0o600);
	expect(await readFile(previous.binary, "utf8")).toBe("previous-native-agent");
});

test.each([
	{ token: machineToken("existing-machine", 1), code: "not-a-code" },
	{ token: "legacy-unrecognized-credential", code: machineToken("existing-machine", 2) },
	{ token: machineToken("existing-machine", 1), code: machineToken("existing-machine", 2).replace("zba1.", "zba2.") },
	{
		token: machineToken("existing-machine", 1),
		code: `zba1.${Buffer.from([0xff]).toString("base64url")}.2.${Buffer.alloc(32, 1).toString("base64url")}`,
	},
])("reconnect refuses unrecognized machine identities without consuming a code: %j", async ({ token, code }) => {
	const fixture = await setup();
	const previous = await existingInstallation(fixture);
	const originalConfig = JSON.stringify({ ...JSON.parse(savedIdentity), token });
	await writeFile(previous.config, originalConfig, { mode: 0o600 });
	const exchange = vi.fn(async () => Response.json({ token: machineToken("existing-machine", 3) }));
	vi.stubGlobal("fetch", exchange);

	await expect(
		installSystemService({ code, reconnect: true }, { ...installerDependencies(fixture), enroll: enrollAgent }),
	).rejects.toThrow();

	expect(exchange).not.toHaveBeenCalled();
	expect(await readFile(previous.config, "utf8")).toBe(originalConfig);
	expect(await readdir(fixture.paths.stateDir)).toEqual(["agent.json"]);
});

test("reconnect rejects a mismatched returned identity before writing the replacement configuration", async () => {
	const fixture = await setup();
	const previous = await existingInstallation(fixture);
	vi.stubGlobal("fetch", async () => Response.json({ token: machineToken("another-machine", 3) }));

	await expect(
		installSystemService(
			{ code: machineToken("existing-machine", 2), reconnect: true },
			{ ...installerDependencies(fixture), enroll: enrollAgent },
		),
	).rejects.toThrow("Controller returned a credential for a different machine");

	expect(await readFile(previous.config, "utf8")).toBe(savedIdentity);
	expect(await readFile(previous.binary, "utf8")).toBe("previous-native-agent");
	expect(await readFile(previous.unit, "utf8")).toBe("previous-unit-definition");
	expect(await readdir(fixture.paths.stateDir)).toEqual(["agent.json"]);
});
