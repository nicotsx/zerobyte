import { basename, resolve } from "node:path";
import { logger } from "@zerobyte/core/node";
import { Command, InvalidArgumentError } from "commander";
import { Cause, Console, Data, Effect, Exit } from "effect";
import { runAgent } from "./agent";
import { loadConfiguration, readConfiguration, writeConfiguration } from "./config";
import { enrollMachine, parseControllerUrl } from "./enrollment";
import { addFolders, chooseFolders, listFolders } from "./folders";
import * as fs from "./fs";
import { HostLive, type Host } from "./host";
import { checkRestic, MIN_RESTIC_VERSION } from "./restic/prerequisites";
import { controlService, defaultServicePaths, installSystemService, SERVICE_CONFIG, showLogs } from "./system-service";

const GRACEFUL_SHUTDOWN_TIMEOUT_MS = 5_000;

class UsageError extends Data.TaggedError("UsageError")<{ message: string }> {}

const runCommand = async <A, E>(program: Effect.Effect<A, E, Host>) => {
	const exit = await Effect.runPromiseExit(Effect.provide(program, HostLive));

	if (Exit.isFailure(exit)) {
		const failure = Cause.squash(exit.cause);

		logger.error(failure instanceof Error ? failure.message : String(failure));
		process.exitCode = 1;
	}
};

const requireServiceHost = Effect.suspend(() => {
	if (process.platform !== "linux")
		return new UsageError({ message: "System service installation supports Linux only" });
	if (process.getuid?.() !== 0)
		return new UsageError({ message: "Run zerobyte-agent install as root (for example, with sudo)" });

	if (basename(process.execPath) === "bun") {
		return new UsageError({ message: "System service installation requires a compiled zerobyte-agent executable" });
	}

	return Effect.void;
});

const waitForShutdown = (builtinLocal: boolean) =>
	Effect.async<void>((resume) => {
		const stop = () => resume(Effect.void);

		process.once("SIGINT", stop);
		process.once("SIGTERM", stop);

		if (builtinLocal) {
			process.stdin.once("end", stop);
			process.stdin.resume();
		}

		return Effect.sync(() => {
			process.off("SIGINT", stop);
			process.off("SIGTERM", stop);
			process.stdin.off("end", stop);
		});
	});

export const program = new Command()
	.name("zerobyte-agent")
	.description(`Zerobyte backup agent (requires Restic ${MIN_RESTIC_VERSION} or newer)`)
	.version(process.env.ZEROBYTE_AGENT_VERSION ?? "dev");

program
	.command("run")
	.description("Run in the foreground (used by the system service)")
	.option("--config <file>", "Agent configuration file", SERVICE_CONFIG)
	.action(async (options: { config: string }) => {
		const builtinLocal = process.env.ZEROBYTE_BUILTIN_LOCAL_AGENT === "1";

		await runCommand(
			Effect.gen(function* () {
				const resticVersion = yield* checkRestic;
				const configuration = yield* loadConfiguration(options.config);

				yield* Effect.raceFirst(
					runAgent({ configuration, resticVersion, builtinLocal }),
					waitForShutdown(builtinLocal),
				).pipe(
					Effect.ensuring(
						Effect.sync(() => {
							setTimeout(() => process.exit(), GRACEFUL_SHUTDOWN_TIMEOUT_MS);
						}),
					),
				);
			}),
		);
	});

program
	.command("install")
	.description("Install or upgrade the Linux systemd service")
	.option("--controller <url>", "HTTPS controller URL (required on first install; updates the address on upgrade)")
	.option("--code <code>", "Connection code to enroll or reconnect this machine, preserving existing folders")
	.option("--root <folders...>", "Optional folders for unattended setup")
	.option("--allow-insecure", "Allow an HTTP development controller")
	.action((options: { controller?: string; code?: string; root?: string[]; allowInsecure?: boolean }) =>
		runCommand(
			Effect.gen(function* () {
				yield* requireServiceHost;

				let controller: URL | undefined;
				if (options.controller) {
					controller = yield* parseControllerUrl(options.controller, options.allowInsecure);
				}

				yield* installSystemService({
					controller,
					code: options.code,
					roots: options.root ?? [],
					sourceBinary: process.execPath,
					paths: defaultServicePaths,
				});

				yield* Console.log(
					"Zerobyte agent installed and running in the background. Choose folders: sudo zerobyte-agent folders add. Logs: sudo zerobyte-agent logs",
				);
			}),
		),
	);

program
	.command("enroll")
	.description("Enroll this machine without installing a service, for manual runs")
	.requiredOption("--controller <url>", "HTTPS URL of the Zerobyte controller")
	.requiredOption("--code <code>", "One-time connection code from the dashboard")
	.requiredOption("--config <file>", "Where to save the agent configuration")
	.option("--root <folders...>", "Folders to share (can be repeated)")
	.option("--allow-insecure", "Allow an HTTP development controller")
	.action((options: { controller: string; code: string; config: string; root?: string[]; allowInsecure?: boolean }) =>
		runCommand(
			Effect.gen(function* () {
				if (yield* fs.exists(options.config)) {
					return yield* new UsageError({
						message: `This machine already has an agent configuration at ${resolve(options.config)}. For an installed agent, use install --code to replace its credential and preserve its folders.`,
					});
				}

				yield* checkRestic;

				const controller = yield* parseControllerUrl(options.controller, options.allowInsecure);
				const configuration = yield* enrollMachine(controller, options.code, options.root ?? []);

				yield* writeConfiguration(options.config, configuration);
				yield* Console.log(`Machine enrolled. Start it with: zerobyte-agent run --config ${options.config}`);
			}),
		),
	);

program
	.command("check")
	.description("Verify the Restic prerequisite without enrolling or connecting")
	.action(() => runCommand(Effect.flatMap(checkRestic, (version) => Console.log(`Restic ${version}: ready`))));

for (const action of ["start", "stop", "restart", "status"] as const) {
	program
		.command(action)
		.description(
			action === "status"
				? "Show background agent status"
				: `${action[0]!.toUpperCase()}${action.slice(1)} the background agent`,
		)
		.action(() => runCommand(controlService(action)));
}

program
	.command("logs")
	.description("Show recent agent logs")
	.option("-f, --follow", "Stream logs until Ctrl+C", false)
	.option(
		"-n, --lines <count>",
		"Number of recent lines",
		(value: string) => {
			const lines = Number(value);
			if (!/^\d+$/.test(value) || !Number.isSafeInteger(lines) || lines < 1) {
				throw new InvalidArgumentError("Enter a positive whole number.");
			}

			return lines;
		},
		30,
	)
	.action((options: { lines: number; follow: boolean }) => runCommand(showLogs(options)));

const folders = program.command("folders").description("Choose folders this machine shares with Zerobyte");

folders
	.command("add")
	.description("Browse and select folders to share")
	.option("--config <file>", "Agent configuration file", SERVICE_CONFIG)
	.action((options: { config: string }) =>
		runCommand(
			Effect.gen(function* () {
				yield* readConfiguration(options.config);

				const selected = yield* chooseFolders;
				if (!selected.length) return;

				const added = yield* addFolders(options.config, selected);
				if (!added.length) return yield* Console.log("These folders are already shared.");

				yield* Console.log(`Added ${added.length} folder${added.length === 1 ? "" : "s"}.`);

				if (resolve(options.config) === SERVICE_CONFIG) yield* controlService("restart");
				else yield* Console.log("Restart your agent to share the new folders.");
			}),
		),
	);

folders
	.command("list")
	.description("Show shared folders")
	.option("--config <file>", "Agent configuration file", SERVICE_CONFIG)
	.action((options: { config: string }) =>
		runCommand(
			Effect.flatMap(listFolders(options.config), (roots) =>
				Console.log(
					roots.length
						? roots.map((root) => `${root.label}  ${root.path}`).join("\n")
						: "No folders shared yet. Run sudo zerobyte-agent folders add.",
				),
			),
		),
	);

if (import.meta.main) await program.parseAsync(process.argv);
