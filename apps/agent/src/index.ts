import { logger } from "@zerobyte/core/node";
import { Command, InvalidArgumentError } from "commander";
import { Effect, Fiber } from "effect";
import { createControllerSession, type ControllerSession } from "./controller-session";
import { startAgentJobs } from "./jobs";
import { getDefaultTrustedRootRegistry } from "./trusted-roots";
import { configureAgent, defaultConfigPath, enrollAgent, readAgentConfiguration } from "./enrollment";
import { checkRestic, MIN_RESTIC_VERSION } from "./restic/prerequisites";
import { installSystemService, SERVICE_CONFIG } from "./system-service";
import { controlService, showLogs } from "./service-commands";
import { chooseFolders, addFolders, listFolders } from "./folders";
import { updateSystemService } from "./update";

const INITIAL_RECONNECT_DELAY_MS = 1_000;
const MAX_RECONNECT_DELAY_MS = 30_000;

export class Agent {
	private ws: WebSocket | null = null;
	private controllerSession: ControllerSession | null = null;
	private reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
	private reconnectDelayMs = INITIAL_RECONNECT_DELAY_MS;
	private jobFibers: Fiber.RuntimeFiber<never, never>[] | null = null;
	private stopped = false;

	constructor(
		private readonly controllerUrl = process.env.ZEROBYTE_CONTROLLER_URL,
		private readonly agentToken = process.env.ZEROBYTE_AGENT_TOKEN,
	) {}

	private startJobs() {
		const builtinLocal = process.env.ZEROBYTE_BUILTIN_LOCAL_AGENT === "1";

		if (!builtinLocal || this.jobFibers) return;
		this.jobFibers = startAgentJobs();
	}

	private scheduleReconnect() {
		if (this.stopped || this.reconnectTimeout) return;

		const jitterFactor = 0.8 + Math.random() * 0.4;
		const delay = Math.round(this.reconnectDelayMs * jitterFactor);

		this.reconnectDelayMs = Math.min(this.reconnectDelayMs * 2, MAX_RECONNECT_DELAY_MS);
		this.reconnectTimeout = setTimeout(() => {
			this.reconnectTimeout = null;
			this.connect();
		}, delay);
	}

	private validateConfiguration() {
		if (!this.controllerUrl) throw new Error("Env variable ZEROBYTE_CONTROLLER_URL is not set");
		if (!this.agentToken) throw new Error("Env variable ZEROBYTE_AGENT_TOKEN is not set");

		const url = new URL(this.controllerUrl);
		const loopback = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]";
		const secureWebSocket = url.protocol === "wss:";
		const loopbackWebSocket = loopback && url.protocol === "ws:";
		const developmentWebSocket = process.env.ZEROBYTE_AGENT_ALLOW_INSECURE === "1" && url.protocol === "ws:";

		if (!secureWebSocket && !loopbackWebSocket && !developmentWebSocket) {
			throw new Error(
				"Agent connections require a wss:// controller URL unless enrolled with --allow-insecure for development",
			);
		}

		return url;
	}

	connect() {
		this.stopped = false;
		const url = this.validateConfiguration();

		getDefaultTrustedRootRegistry();
		this.startJobs();

		if (this.reconnectTimeout) {
			clearTimeout(this.reconnectTimeout);
			this.reconnectTimeout = null;
		}

		if (this.ws) return;

		const authorization = `Bearer ${this.agentToken}`;
		const ws = new WebSocket(url.toString(), { headers: { authorization } });
		const controllerSession = createControllerSession(ws);

		this.ws = ws;
		this.controllerSession = controllerSession;

		ws.onopen = () => {
			if (this.ws !== ws) return;
			this.reconnectDelayMs = INITIAL_RECONNECT_DELAY_MS;
			logger.info("Agent connected to controller");
			controllerSession.onOpen();
		};

		ws.onmessage = (event) => {
			if (this.ws === ws) controllerSession.onMessage(event.data);
		};

		ws.onclose = () => {
			controllerSession.close();

			if (this.controllerSession === controllerSession) this.controllerSession = null;
			if (this.ws !== ws) return;

			this.ws = null;
			logger.info("Agent disconnected from controller");
			this.scheduleReconnect();
		};

		ws.onerror = () => logger.error("Agent websocket connection failed");
	}

	stop() {
		this.stopped = true;

		if (this.reconnectTimeout) {
			clearTimeout(this.reconnectTimeout);
			this.reconnectTimeout = null;
		}

		this.controllerSession?.close();
		this.controllerSession = null;

		const ws = this.ws;

		this.ws = null;
		ws?.close(1000, "agent_shutdown");

		if (this.jobFibers) {
			for (const fiber of this.jobFibers) Effect.runFork(Fiber.interrupt(fiber));
			this.jobFibers = null;
		}
	}
}

const startAgent = async (configPath?: string) => {
	await configureAgent(configPath);

	const agent = new Agent();
	const stop = () => agent.stop();

	process.once("SIGINT", stop);
	process.once("SIGTERM", stop);

	agent.connect();
};

export const program = new Command()
	.name("zerobyte-agent")
	.configureHelp({ showGlobalOptions: true })
	.description(`Zerobyte backup agent (requires Restic ${MIN_RESTIC_VERSION} or newer)`)
	.version(process.env.ZEROBYTE_AGENT_VERSION ?? "dev")
	.option("--config <file>", "Override the identity file for manual runs or folder selection")
	.action(async (options: { config?: string }) => {
		if (process.env.ZEROBYTE_BUILTIN_LOCAL_AGENT === "1" || options.config) {
			await checkRestic();
			await startAgent(options.config);
		} else {
			await controlService("start");
			console.info("Agent running in the background. View logs: sudo zerobyte-agent logs");
		}
	});

program
	.command("enroll")
	.description("Connect this machine and start it in the background")
	.requiredOption("--controller <url>", "HTTPS URL of the Zerobyte controller")
	.requiredOption("--code <code>", "One-time connection code from the dashboard")
	.option("--root <folders...>", "Optional folders for unattended setup (can be repeated)")
	.option("--allow-insecure", "Allow HTTP enrollment and WebSocket connections to a development controller")
	.option("--no-start", "Save the identity without starting the agent")
	.action(
		async (
			options: { controller: string; code: string; root?: string[]; start: boolean; allowInsecure?: boolean },
			command: Command,
		) => {
			const customConfig = command.optsWithGlobals<{ config?: string }>().config;

			if (options.start) {
				if (customConfig) throw new Error("Use --no-start with --config for manual enrollment.");
				await installSystemService({
					controller: options.controller,
					code: options.code,
					roots: options.root,
					allowInsecure: options.allowInsecure,
				});
				console.info(
					"Machine connected and running in the background. Choose folders: sudo zerobyte-agent folders add",
				);
			} else {
				await checkRestic();
				const config = customConfig ?? defaultConfigPath();

				await enrollAgent({
					controller: options.controller,
					code: options.code,
					roots: options.root,
					allowInsecure: options.allowInsecure,
					configPath: config,
				});
				console.info(`Machine enrolled. Configuration saved to ${config}.`);
			}
		},
	);

program
	.command("check")
	.description("Verify the Restic prerequisite without enrolling or connecting")
	.action(async () => console.info(`Restic ${await checkRestic()}: ready`));

program
	.command("install")
	.description("Install or upgrade the Linux systemd service")
	.option("--controller <url>", "HTTPS URL of the Zerobyte controller (required on first install)")
	.option("--code <code>", "One-time connection code from the dashboard (required on first install)")
	.option("--root <folders...>", "Optional folders for unattended setup")
	.option("--allow-insecure", "Allow HTTP connections to a development controller")
	.action(async (options: { controller?: string; code?: string; root?: string[]; allowInsecure?: boolean }) => {
		const result = await installSystemService({
			controller: options.controller,
			code: options.code,
			roots: options.root,
			allowInsecure: options.allowInsecure,
		});

		console.info(
			`${result.enrolled ? "Zerobyte agent installed" : "Zerobyte agent upgraded"} and running in the background. Choose folders: sudo zerobyte-agent folders add. Logs: sudo zerobyte-agent logs`,
		);
	});

program
	.command("update")
	.description("Download and install a Zerobyte agent release")
	.option("--version <version>", "Release tag to install", "latest")
	.action(async (options: { version: string }) => {
		console.info(`Downloading Zerobyte agent ${options.version}...`);
		await updateSystemService(options.version);
		console.info("Zerobyte agent update completed.");
	});

program
	.command("run")
	.description("Run in the foreground (used by the system service)")
	.action(async (_options, command: Command) => {
		await checkRestic();
		await startAgent(command.optsWithGlobals<{ config?: string }>().config);
	});

for (const action of ["start", "stop", "restart", "status"] as const) {
	program
		.command(action)
		.description(
			action === "status"
				? "Show background agent status"
				: `${action[0]!.toUpperCase() + action.slice(1)} the background agent`,
		)
		.action(async () => controlService(action));
}

program
	.command("logs")
	.description("Show recent agent logs")
	.option("-f, --follow", "Stream logs until Ctrl+C")
	.option(
		"-n, --lines <count>",
		"Number of recent lines",
		(value: string) => {
			const number = Number(value);

			if (!/^\d+$/.test(value) || !Number.isSafeInteger(number) || number < 1)
				throw new InvalidArgumentError("Enter a positive whole number.");
			return number;
		},
		30,
	)
	.action(async (options: { lines: number; follow?: boolean }) => showLogs(options));

const folders = program.command("folders").description("Choose folders this machine shares with Zerobyte");

folders
	.command("add")
	.description("Browse and select folders to share")
	.action(async (_options, command: Command) => {
		const config = command.optsWithGlobals<{ config?: string }>().config ?? SERVICE_CONFIG;

		await readAgentConfiguration(config);
		const selected = await chooseFolders();

		if (!selected.length) return;

		const added = await addFolders(config, selected);

		if (!added.length) {
			console.info("These folders are already shared.");
			return;
		}

		console.info(`Added ${added.length} folder${added.length === 1 ? "" : "s"}.`);

		if (config === SERVICE_CONFIG) await controlService("restart");
		else console.info("Restart your agent to share the new folders.");
	});

folders
	.command("list")
	.description("Show shared folders")
	.action(async (_options, command: Command) => {
		const config = command.optsWithGlobals<{ config?: string }>().config ?? SERVICE_CONFIG;
		const roots = await listFolders(config);

		console.info(
			roots.length
				? roots.map((root) => `${root.descriptor.label}  ${root.configuredPath}`).join("\n")
				: "No folders shared yet. Run sudo zerobyte-agent folders add.",
		);
	});

if (import.meta.main) {
	try {
		await program.parseAsync(process.argv);
	} catch (error) {
		if (error instanceof Error && error.name === "ExitPromptError") {
			process.exitCode = 0;
		} else {
			logger.error(error instanceof Error ? error.message : "Agent startup failed");
			process.exitCode = 78;
		}
	}
}
