import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { chmod, copyFile, lstat, mkdir, rename, rm, writeFile } from "node:fs/promises";
import { basename } from "node:path";
import { promisify } from "node:util";
import { lock } from "proper-lockfile";
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
	reconnect?: boolean;
};

type InstallDependencies = {
	sourceBinary?: string;
	paths?: ServicePaths;
	platform?: NodeJS.Platform;
	uid?: number;
	runCommand?: (command: string, args: string[]) => Promise<void | number | string>;
	renameFile?: typeof rename;
	checkPrerequisite?: () => Promise<unknown>;
	enroll?: typeof enrollAgent;
};

const defaultPaths: ServicePaths = {
	installDir: "/usr/local/bin",
	stateDir: "/var/lib/zerobyte-agent",
	serviceDir: "/etc/systemd/system",
};

const runCommand = async (command: string, args: string[]) => {
	const { stdout } = await execFileAsync(command, args, {
		env: { PATH: SERVICE_PATH, HOME: defaultPaths.stateDir },
	});

	return stdout.trim();
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
	const publish = dependencies.renameFile ?? rename;
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

	if (await isSymbolicLink(paths.stateDir)) {
		throw new Error("Agent state and configuration must not be symbolic links");
	}

	await mkdir(paths.stateDir, { recursive: true, mode: 0o700 });
	const release = await lock(paths.stateDir);
	let releaseConfiguration: (() => Promise<void>) | undefined;

	try {
		if (await isSymbolicLink(config)) {
			throw new Error("Agent state and configuration must not be symbolic links");
		}

		if ((await isSymbolicLink(binary)) || (await isSymbolicLink(unit))) {
			throw new Error("Existing agent executable and service unit must not be symbolic links");
		}

		const alreadyEnrolled = await exists(config);
		if (alreadyEnrolled && (options.controller || options.reconnect)) {
			releaseConfiguration = await lock(config, { realpath: false });
		}

		const configuration = alreadyEnrolled ? await readAgentConfiguration(config) : undefined;

		const suppliedEnrollment = Boolean(
			options.code || options.roots?.length || (options.allowInsecure && !options.controller),
		);

		if (alreadyEnrolled && suppliedEnrollment && !options.reconnect) {
			throw new Error(
				"This machine is already enrolled. Run install without enrollment options to update it, or use --reconnect --code to replace its credential while preserving folders.",
			);
		}

		if (options.reconnect && (!alreadyEnrolled || !options.code)) {
			throw new Error("Reconnection requires an existing machine configuration and --code");
		}

		if (options.reconnect && options.roots?.length) {
			throw new Error(
				"Reconnection preserves existing folders; use folders add or folders remove to change them",
			);
		}

		if (!alreadyEnrolled && (!options.controller || !options.code)) {
			throw new Error("Initial installation requires --controller and --code");
		}

		const controller = options.controller ? new URL(options.controller) : undefined;
		if (
			controller &&
			((controller.protocol !== "https:" && !(options.allowInsecure && controller.protocol === "http:")) ||
				controller.username ||
				controller.password)
		) {
			throw new Error(
				"Use an HTTPS controller URL without embedded credentials, or --allow-insecure for HTTP development.",
			);
		}

		const savedController = options.reconnect && configuration ? new URL(configuration.controllerUrl) : undefined;
		if (savedController) {
			savedController.protocol = savedController.protocol === "wss:" ? "https:" : "http:";
			if (controller && controller.origin !== savedController.origin) {
				throw new Error(
					"Reconnection must use the saved controller. Run install --controller without --code to update its address first.",
				);
			}
		}

		await prerequisite();
		await chmod(paths.stateDir, 0o700);

		await mkdir(paths.installDir, { recursive: true });
		await mkdir(paths.serviceDir, { recursive: true });

		const attempt = randomUUID();
		const stagedBinary = `${paths.installDir}/.zerobyte-agent.${attempt}`;
		const stagedUnit = `${paths.serviceDir}/.zerobyte-agent.${attempt}.service`;
		const savedBinary = `${stagedBinary}.previous`;
		const savedUnit = `${stagedUnit}.previous`;
		const stagedConfig = `${config}.${attempt}.tmp`;
		const savedConfig = `${stagedConfig}.previous`;
		const hadBinary = await exists(binary);
		const hadUnit = await exists(unit);

		let publishedBinary = false;
		let publishedUnit = false;
		let publishedConfig = false;
		let reconnectedIdentity = false;
		let preserveReconnection = false;
		let activationStarted = false;
		let preserveBackups = false;
		let wasEnabled = false;
		let wasActive = false;

		const systemctl = async (args: string[]) => {
			const status = await execute("systemctl", args);
			if (typeof status === "number" && status !== 0) {
				throw new Error(`systemctl ${args.join(" ")} failed (exit ${status})`);
			}
		};

		const serviceState = async (operation: "is-enabled" | "is-active", inactiveStatuses: number[]) => {
			let status: void | number | string;
			let exitCode = 0;

			try {
				status = await execute("systemctl", [operation, "zerobyte-agent.service"]);
			} catch (error) {
				const failure = error as { code?: number | string; stdout?: string };
				if (typeof failure.code !== "number" || !inactiveStatuses.includes(failure.code)) throw error;
				status = failure.stdout?.trim() || undefined;
				exitCode = failure.code;
			}

			if (typeof status === "string") {
				const state = status.trim();
				if (operation === "is-enabled") {
					if (state === "enabled") return true;
					if (state === "disabled" || state === "not-found") return false;
				} else {
					if (state === "active") return true;
					if (["inactive", "failed", "unknown"].includes(state)) return false;
				}

				throw new Error(`Unsupported prior service state: ${operation} returned "${state}"`);
			}

			const code = typeof status === "number" ? status : exitCode;
			if (code === 0) return true;
			if (inactiveStatuses.includes(code)) return false;
			throw new Error(`Cannot inspect service state: systemctl ${operation} failed (exit ${code})`);
		};

		try {
			const source = await lstat(sourceBinary);
			if (!source.isFile()) throw new Error("Agent executable must be a regular file");

			await copyFile(sourceBinary, stagedBinary);
			await chmod(stagedBinary, 0o755);
			await writeFile(stagedUnit, serviceUnit(binary, config, paths.stateDir), { mode: 0o644 });
			await chmod(stagedUnit, 0o644);

			const validationStatus = await execute(stagedBinary, ["--version"]);
			if (typeof validationStatus === "number" && validationStatus !== 0) {
				throw new Error(`Staged agent validation failed (exit ${validationStatus})`);
			}

			if (hadBinary) await copyFile(binary, savedBinary);
			if (hadUnit) await copyFile(unit, savedUnit);

			wasEnabled = await serviceState("is-enabled", [1, 4]);
			wasActive = await serviceState("is-active", [3, 4]);
			if (!hadUnit && (wasEnabled || wasActive)) {
				throw new Error(
					"An existing service outside the installation directory requires attention before installation",
				);
			}

			if (!alreadyEnrolled) {
				await enroll({
					controller: options.controller!,
					code: options.code!,
					roots: options.roots ?? [],
					allowInsecure: options.allowInsecure,
					configPath: config,
				});
			} else if (options.reconnect && savedController && configuration) {
				await enroll({
					controller: savedController.origin,
					code: options.code!,
					allowInsecure: configuration.allowInsecure,
					configPath: stagedConfig,
					existingConfiguration: configuration,
				});

				preserveReconnection = true;
				await publish(stagedConfig, config);
				publishedConfig = true;
				reconnectedIdentity = true;
				preserveReconnection = false;
			} else if (controller && configuration) {
				const connectionUrl = new URL("/api/v1/agents/connect", controller);
				connectionUrl.protocol = controller.protocol === "https:" ? "wss:" : "ws:";

				await copyFile(config, savedConfig);
				await chmod(savedConfig, 0o600);
				await writeFile(
					stagedConfig,
					JSON.stringify(
						{
							...configuration,
							controllerUrl: connectionUrl.toString(),
							allowInsecure: controller.protocol === "http:",
						},
						null,
						2,
					),
					{ mode: 0o600, flag: "wx" },
				);
				await publish(stagedConfig, config);
				publishedConfig = true;
			}

			await publish(stagedBinary, binary);
			publishedBinary = true;
			await publish(stagedUnit, unit);
			publishedUnit = true;

			activationStarted = true;
			await systemctl(["daemon-reload"]);
			await systemctl(["enable", "zerobyte-agent.service"]);
			await systemctl(["restart", "zerobyte-agent.service"]);
		} catch (error) {
			const rollbackErrors: unknown[] = [];
			const recover = async (action: () => Promise<unknown>) => {
				try {
					await action();
				} catch (rollbackError) {
					rollbackErrors.push(rollbackError);
				}
			};

			if (activationStarted) {
				await recover(() => systemctl(["stop", "zerobyte-agent.service"]));
				if (!hadUnit) await recover(() => systemctl(["disable", "zerobyte-agent.service"]));
			}

			if (publishedBinary) {
				await recover(async () => {
					if (hadBinary) {
						await copyFile(savedBinary, stagedBinary);
						await publish(stagedBinary, binary);
					} else {
						await rm(binary, { force: true });
					}
				});
			}

			if (publishedUnit) {
				await recover(async () => {
					if (hadUnit) {
						await copyFile(savedUnit, stagedUnit);
						await publish(stagedUnit, unit);
					} else {
						await rm(unit, { force: true });
					}
				});
			}

			if (publishedConfig && !reconnectedIdentity) {
				await recover(async () => {
					await copyFile(savedConfig, stagedConfig);
					await publish(stagedConfig, config);
				});
			}

			if (activationStarted) {
				await recover(() => systemctl(["daemon-reload"]));
				if (hadUnit) {
					await recover(() => systemctl([wasEnabled ? "enable" : "disable", "zerobyte-agent.service"]));
				}

				if (wasActive && rollbackErrors.length === 0) {
					await recover(() => systemctl(["restart", "zerobyte-agent.service"]));
				}
			}

			if (rollbackErrors.length > 0) {
				preserveBackups = true;
				const failures = [error, ...rollbackErrors]
					.map((failure) => (failure instanceof Error ? failure.message : String(failure)))
					.join("; ");

				throw new AggregateError(
					[error, ...rollbackErrors],
					`Agent installation failed and rollback was incomplete: ${failures}. Any recovery copies are retained at ${savedBinary} and ${savedUnit}${publishedConfig && !reconnectedIdentity ? ` and ${savedConfig}` : ""}. Saved enrollment remains at ${config}.${reconnectedIdentity ? " The replacement credential is saved; retry install without --code after recovery." : ""}`,
				);
			}

			if (preserveReconnection) {
				throw new Error(
					`Reconnection could not save the replacement identity. It is retained at ${stagedConfig}; restore that file to ${config}, then run install without --code.`,
					{ cause: error },
				);
			}

			if (reconnectedIdentity) {
				throw new Error(
					`Reconnection saved the replacement credential, but installation could not finish. Run install without --code to retry. ${error instanceof Error ? error.message : String(error)}`,
					{ cause: error },
				);
			}

			throw error;
		} finally {
			await Promise.all([
				rm(stagedBinary, { force: true }),
				rm(stagedUnit, { force: true }),
				...(preserveReconnection ? [] : [rm(stagedConfig, { force: true })]),
			]);
			if (!preserveBackups) {
				await Promise.all([
					rm(savedBinary, { force: true }),
					rm(savedUnit, { force: true }),
					rm(savedConfig, { force: true }),
				]);
			}
		}

		return { binary, config, unit, enrolled: !alreadyEnrolled, reconnected: reconnectedIdentity };
	} finally {
		try {
			await releaseConfiguration?.();
		} finally {
			await release();
		}
	}
};
