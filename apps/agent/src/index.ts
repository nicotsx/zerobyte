import { logger } from "@zerobyte/core/node";
import { Effect, Fiber } from "effect";
import { createControllerSession, type ControllerSession } from "./controller-session";
import { startAgentJobs } from "./jobs";
import { getDefaultTrustedRootRegistry } from "./trusted-roots";
import { configureAgent } from "./enrollment";

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
		if (!secureWebSocket && !loopbackWebSocket) {
			throw new Error(
				"Agent connections require a wss:// controller URL except for explicit loopback ws:// URLs",
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

if (import.meta.main) {
	await configureAgent();
	const agent = new Agent();
	const stop = () => agent.stop();
	process.once("SIGINT", stop);
	process.once("SIGTERM", stop);
	agent.connect();
}
