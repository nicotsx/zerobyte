import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { chmod, copyFile, lstat, mkdir, rename, rm, writeFile } from "node:fs/promises";
import { basename } from "node:path";
import { promisify } from "node:util";
import { enrollAgent, readAgentConfiguration } from "./enrollment";
import { checkRestic } from "./restic/prerequisites";

const execFileAsync = promisify(execFile);

export const SERVICE_PATH = "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin";
export const SERVICE_CONFIG = "/var/lib/zerobyte-agent/agent.json";

type ServicePaths = {
	installDir: string;
	stateDir: string;
	serviceDir: string;
};

type EnrollmentOptions = {
	controller?: string;
	code?: string;
	roots?: string[];
	allowInsecure?: boolean;
};

type InstallDependencies = {
	sourceBinary?: string;
	paths?: ServicePaths;
	platform?: NodeJS.Platform;
	uid?: number;
	runCommand?: (command: string, args: string[]) => Promise<void>;
	checkPrerequisite?: () => Promise<unknown>;
	enroll?: typeof enrollAgent;
};

const defaultPaths: ServicePaths = {
	installDir: "/usr/local/bin",
	stateDir: "/var/lib/zerobyte-agent",
	serviceDir: "/etc/systemd/system",
};

const runCommand = async (command: string, args: string[]) => {
	await execFileAsync(command, args, {
		env: { PATH: SERVICE_PATH, HOME: defaultPaths.stateDir },
	});
};

const isSymbolicLink = async (path: string) => {
	try {
		return (await lstat(path)).isSymbolicLink();
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
		throw error;
	}
};

const exists = async (path: string) => {
	try {
		await lstat(path);
		return true;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
		throw error;
	}
};

const serviceUnit = (binary: string, config: string, stateDir: string) => `[Unit]
Description=Zerobyte backup agent
Wants=network-online.target
After=network-online.target

[Service]
Type=exec
ExecStart=${binary} run --config ${config}
WorkingDirectory=${stateDir}
Environment=HOME=${stateDir}
Environment=PATH=${SERVICE_PATH}
StateDirectory=zerobyte-agent
StateDirectoryMode=0700
UMask=0077
NoNewPrivileges=true
Restart=on-failure
RestartSec=10
RestartPreventExitStatus=78
TimeoutStopSec=30

[Install]
WantedBy=multi-user.target
`;

export const installSystemService = async (options: EnrollmentOptions, dependencies: InstallDependencies = {}) => {
	const paths = dependencies.paths ?? defaultPaths;
	const config = `${paths.stateDir}/agent.json`;
	const binary = `${paths.installDir}/zerobyte-agent`;
	const unit = `${paths.serviceDir}/zerobyte-agent.service`;
	const sourceBinary = dependencies.sourceBinary ?? process.execPath;
	const execute = dependencies.runCommand ?? runCommand;
	const prerequisite = dependencies.checkPrerequisite ?? checkRestic;
	const enroll = dependencies.enroll ?? enrollAgent;
	const platform = dependencies.platform ?? process.platform;
	const uid = dependencies.uid ?? process.getuid?.();

	if (platform !== "linux") throw new Error("System service installation supports Linux only");
	if (uid !== 0) throw new Error("Run zerobyte-agent install as root (for example, with sudo)");

	if (basename(sourceBinary) === "bun") {
		throw new Error("System service installation requires a compiled zerobyte-agent executable");
	}

	await execute("getconf", ["GNU_LIBC_VERSION"]);
	await execute("systemctl", ["show-environment"]);

	if ((await isSymbolicLink(paths.stateDir)) || (await isSymbolicLink(config))) {
		throw new Error("Agent state and configuration must not be symbolic links");
	}

	const alreadyEnrolled = await exists(config);
	if (alreadyEnrolled) await readAgentConfiguration(config);

	const suppliedEnrollment = Boolean(
		options.controller || options.code || options.roots?.length || options.allowInsecure,
	);

	if (alreadyEnrolled && suppliedEnrollment) {
		throw new Error(
			`This machine is already enrolled. Run install without enrollment options to update it, or move ${config} aside before rotating its credential.`,
		);
	}

	if (!alreadyEnrolled && (!options.controller || !options.code)) {
		throw new Error("Initial installation requires --controller and --code");
	}

	await prerequisite();
	await mkdir(paths.stateDir, { recursive: true, mode: 0o700 });
	await chmod(paths.stateDir, 0o700);

	if (!alreadyEnrolled) {
		await enroll({
			controller: options.controller!,
			code: options.code!,
			roots: options.roots ?? [],
			allowInsecure: options.allowInsecure,
			configPath: config,
		});
	}

	await mkdir(paths.installDir, { recursive: true });
	await mkdir(paths.serviceDir, { recursive: true });

	const stagedBinary = `${paths.installDir}/.zerobyte-agent.${randomUUID()}`;
	const stagedUnit = `${paths.serviceDir}/.zerobyte-agent.service.${randomUUID()}`;

	try {
		await copyFile(sourceBinary, stagedBinary);
		await chmod(stagedBinary, 0o755);
		await writeFile(stagedUnit, serviceUnit(binary, config, paths.stateDir), { mode: 0o644 });
		await chmod(stagedUnit, 0o644);
		await rename(stagedBinary, binary);
		await rename(stagedUnit, unit);
	} finally {
		await Promise.all([rm(stagedBinary, { force: true }), rm(stagedUnit, { force: true })]);
	}

	await execute("systemctl", ["daemon-reload"]);
	await execute("systemctl", ["enable", "zerobyte-agent.service"]);
	await execute("systemctl", ["restart", "zerobyte-agent.service"]);

	return { binary, config, unit, enrolled: !alreadyEnrolled };
};
