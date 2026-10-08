import { join } from "node:path";
import { toControllerOrigin, toAgentConnectionUrl } from "@zerobyte/contracts/agent-connection";
import { Data, Effect } from "effect";
import { readConfiguration, writeConfiguration } from "./config";
import { enrollMachine, reconnectMachine } from "./enrollment";
import * as fs from "./fs";
import { Host } from "./host";
import { checkRestic } from "./restic/prerequisites";

export const SERVICE_PATH = "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin";
const SERVICE_NAME = "zerobyte-agent.service";

export type ServicePaths = { installDir: string; stateDir: string; serviceDir: string };

export const defaultServicePaths: ServicePaths = {
	installDir: "/usr/local/bin",
	stateDir: "/var/lib/zerobyte-agent",
	serviceDir: "/etc/systemd/system",
};

export const SERVICE_CONFIG = join(defaultServicePaths.stateDir, "agent.json");

export class InstallError extends Data.TaggedError("InstallError")<{ message: string; cause?: unknown }> {}

export type InstallOptions = {
	controller?: URL;
	code?: string;
	roots: ReadonlyArray<string>;
	sourceBinary: string;
	paths: ServicePaths;
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
TimeoutStopSec=30

[Install]
WantedBy=multi-user.target
`;

/**
 * Everything that can fail without side effects (prerequisites, staging, verifying the new executable) runs
 * before the connection code is exchanged, so a failed attempt never consumes the single-use code.
 */
export const installSystemService = (options: InstallOptions) =>
	Effect.gen(function* () {
		const host = yield* Host;
		const { paths, controller, code, roots } = options;

		const config = join(paths.stateDir, "agent.json");
		const binary = join(paths.installDir, "zerobyte-agent");
		const unit = join(paths.serviceDir, SERVICE_NAME);

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

		if (!saved && (!controller || !code)) {
			return yield* new InstallError({ message: "Initial installation requires --controller and --code" });
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

		const stagedBinary = yield* fs.stagingPath(binary);
		const stagedUnit = yield* fs.stagingPath(unit);

		yield* fs.copy(options.sourceBinary, stagedBinary);
		yield* fs.changeMode(stagedBinary, 0o755);
		yield* fs.writeText(stagedUnit, serviceUnit(binary, config, paths.stateDir), 0o644);
		yield* host.output(stagedBinary, ["--version"]);

		if (!saved && controller && code) {
			const configuration = yield* enrollMachine(controller, code, roots);

			yield* writeConfiguration(config, configuration);
		} else if (saved && code) {
			const address = controller ?? new URL(toControllerOrigin(saved.controllerUrl));
			const configuration = yield* reconnectMachine(saved, address, code);

			yield* writeConfiguration(config, configuration);
		} else if (saved && controller) {
			yield* writeConfiguration(config, { ...saved, controllerUrl: toAgentConnectionUrl(controller).href });
		}

		yield* Effect.gen(function* () {
			yield* fs.move(stagedBinary, binary);
			yield* fs.move(stagedUnit, unit);
			yield* host.output("systemctl", ["daemon-reload"]);
			yield* host.output("systemctl", ["enable", SERVICE_NAME]);
			yield* host.output("systemctl", ["restart", SERVICE_NAME]);
		}).pipe(
			Effect.mapError(
				(cause) =>
					new InstallError({
						message: `Agent installation did not finish: ${cause.message}. The saved configuration at ${config} is intact; run install again without --code to retry.`,
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
