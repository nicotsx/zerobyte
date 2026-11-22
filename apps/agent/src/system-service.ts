import { join } from "node:path";
import { toControllerOrigin, toAgentConnectionUrl } from "@zerobyte/contracts/agent-connection";
import { Data, Effect } from "effect";
import { readConfiguration, writeConfiguration } from "./config";
import { enrollMachine, reconnectMachine } from "./enrollment";
import * as fs from "./fs";
import { Host } from "./host";
import { checkRestic } from "./restic/prerequisites";
import { SERVICE_NAME, SERVICE_PATH, type ServicePaths } from "./service-paths";
import {
	currentAgentVersion,
	assertTrustedUpdateDirectory,
	SYSTEMD_UPDATE_ENV,
	SYSTEMD_UPDATE_EXIT_CODE,
	SYSTEMD_STARTUP_TIMEOUT_MS,
	systemdRecoveryScript,
	updateDirectory,
} from "./systemd-update";

export { defaultServicePaths, SERVICE_CONFIG, SERVICE_PATH } from "./service-paths";

export class InstallError extends Data.TaggedError("InstallError")<{ message: string; cause?: unknown }> {}

export type InstallOptions = {
	controller?: URL;
	requestCode?: () => Promise<string>;
	roots: ReadonlyArray<string>;
	sourceBinary: string;
	paths: ServicePaths;
};

const serviceUnit = (binary: string, config: string, stateDir: string, recovery?: string) => `[Unit]
Description=Zerobyte backup agent
Wants=network-online.target
After=network-online.target

[Service]
${
	recovery
		? `Type=notify
NotifyAccess=all
TimeoutStartSec=${SYSTEMD_STARTUP_TIMEOUT_MS / 1000}
SuccessExitStatus=${SYSTEMD_UPDATE_EXIT_CODE}
RestartForceExitStatus=${SYSTEMD_UPDATE_EXIT_CODE}
Environment=${SYSTEMD_UPDATE_ENV}=1
ExecStartPre=${recovery} ${binary} start
ExecStopPost=${recovery} ${binary} stop`
		: "Type=exec"
}
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
TimeoutStopSec=30

[Install]
WantedBy=multi-user.target
`;

/**
 * Everything that can fail without side effects (prerequisites, staging, verifying the new executable) runs
 * before the connection code is exchanged, so a failed attempt never consumes the single-use code.
 */
export const installSystemService = (options: InstallOptions, checkUpdateDirectory = assertTrustedUpdateDirectory) =>
	Effect.gen(function* () {
		const host = yield* Host;
		const { paths, controller, requestCode, roots } = options;

		const config = join(paths.stateDir, "agent.json");
		const binary = join(paths.installDir, "zerobyte-agent");
		const unit = join(paths.serviceDir, SERVICE_NAME);
		const directory = updateDirectory(paths.installDir);
		const recovery = currentAgentVersion() ? join(directory, "recover") : undefined;

		yield* host
			.output("systemctl", ["show-environment"])
			.pipe(
				Effect.mapError(
					(cause) => new InstallError({ message: "The agent service requires a running systemd.", cause }),
				),
			);

		const saved = yield* readConfiguration(config).pipe(
			Effect.catchTag("ConfigurationMissing", () => Effect.succeed(undefined)),
		);

		if (!saved && (!controller || !requestCode)) {
			return yield* new InstallError({
				message: "Initial installation requires a controller and a connection code",
			});
		}
		if (saved && roots.length) {
			return yield* new InstallError({
				message: "Installation preserves existing folders; use folders add to share more folders",
			});
		}

		yield* checkRestic;

		yield* fs.makeDirectory(paths.stateDir, 0o700);
		yield* fs.changeMode(paths.stateDir, 0o700);
		yield* fs.makeDirectory(paths.installDir);
		yield* fs.makeDirectory(paths.serviceDir);

		if (recovery) {
			yield* host.output("systemd-notify", ["--version"]);
			yield* fs.makeDirectory(directory, 0o700);
			yield* Effect.try({
				try: () => checkUpdateDirectory(paths.installDir, directory),
				catch: (cause) => new InstallError({ message: "The agent update directory is unsafe", cause }),
			});
			yield* fs.changeMode(directory, 0o700);
		}

		const stagedBinary = yield* fs.stagingPath(binary);
		const stagedUnit = yield* fs.stagingPath(unit);
		const stagedRecovery = recovery ? yield* fs.stagingPath(recovery) : undefined;

		yield* fs.copy(options.sourceBinary, stagedBinary);
		yield* fs.changeMode(stagedBinary, 0o755);
		yield* fs.writeText(stagedUnit, serviceUnit(binary, config, paths.stateDir, recovery), 0o644);
		if (stagedRecovery) yield* fs.writeText(stagedRecovery, systemdRecoveryScript, 0o700);
		yield* host.output(stagedBinary, ["--version"]);

		let connectionCode: string | undefined;

		if (requestCode) {
			connectionCode = yield* Effect.tryPromise({
				try: requestCode,
				catch: (cause) => new InstallError({ message: "Could not read the connection code", cause }),
			});
		}

		if (!saved && controller && connectionCode) {
			const configuration = yield* enrollMachine(controller, connectionCode, roots);

			yield* writeConfiguration(config, configuration);
		} else if (saved && connectionCode) {
			const address = controller ?? new URL(toControllerOrigin(saved.controllerUrl));
			const configuration = yield* reconnectMachine(saved, address, connectionCode);

			yield* writeConfiguration(config, configuration);
		} else if (saved && controller) {
			yield* writeConfiguration(config, { ...saved, controllerUrl: toAgentConnectionUrl(controller).href });
		}

		yield* Effect.gen(function* () {
			if (recovery && stagedRecovery) {
				if (yield* fs.exists(unit)) yield* host.output("systemctl", ["stop", SERVICE_NAME]);
				yield* fs.move(stagedRecovery, recovery);
				yield* host.output(recovery, [binary, "install"]);
			}
			yield* fs.move(stagedBinary, binary);
			yield* fs.move(stagedUnit, unit);
			yield* host.output("systemctl", ["daemon-reload"]);
			yield* host.output("systemctl", ["enable", SERVICE_NAME]);
			yield* host.output("systemctl", ["restart", SERVICE_NAME]);
		}).pipe(
			Effect.mapError(
				(cause) =>
					new InstallError({
						message: `Agent installation did not finish: ${cause.message}. The saved configuration at ${config} is intact; run install again without requesting a new connection code.`,
						cause,
					}),
			),
		);
	}).pipe(Effect.scoped);

export const controlService = (action: "start" | "stop" | "restart" | "status") =>
	Effect.flatMap(Host, (host) => host.attach("systemctl", [action, SERVICE_NAME, "--no-pager"]));

export const showLogs = (options: { lines: number; follow: boolean }) =>
	Effect.flatMap(Host, (host) =>
		host.attach("journalctl", [
			"--unit=zerobyte-agent",
			"--no-pager",
			"--output=cat",
			`--lines=${options.lines}`,
			...(options.follow ? ["--follow"] : []),
		]),
	);
