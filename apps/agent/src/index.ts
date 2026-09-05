import { logger } from "@zerobyte/core/node";
import { createControllerSession, type ControllerSession } from "./controller-session";

const controllerUrl = process.env.ZEROBYTE_CONTROLLER_URL;
const agentToken = process.env.ZEROBYTE_AGENT_TOKEN;
const RECONNECT_DELAY_MS = 1000;

export class Agent {
	private ws: WebSocket | null = null;
	private controllerSession: ControllerSession | null = null;
	private reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
	private stopped = false;

	private scheduleReconnect() {
		if (this.stopped || this.reconnectTimeout) {
			return;
		}

		this.reconnectTimeout = setTimeout(() => {
			this.reconnectTimeout = null;
			this.connect();
		}, RECONNECT_DELAY_MS);
	}

	connect() {
		if (this.stopped) return;

		if (this.reconnectTimeout) {
			clearTimeout(this.reconnectTimeout);
			this.reconnectTimeout = null;
		}
		if (this.ws) {
			return;
		}

		if (!controllerUrl) {
			throw new Error("Env variable ZEROBYTE_CONTROLLER_URL is not set");
		}

		if (!agentToken) {
			throw new Error("Env variable ZEROBYTE_AGENT_TOKEN is not set");
		}

		const url = new URL(controllerUrl);
		this.ws = new WebSocket(url.toString(), {
			headers: {
				authorization: `Bearer ${agentToken}`,
			},
		});
		this.controllerSession = createControllerSession(this.ws);

		this.ws.onopen = () => {
			logger.info("Agent connected to controller");
			this.controllerSession?.onOpen();
		};

		this.ws.onmessage = (event) => {
			this.controllerSession?.onMessage(event.data);
		};
		this.ws.onclose = () => {
			this.controllerSession?.close();
			this.controllerSession = null;
			this.ws = null;
			logger.info("Agent disconnected from controller");
			this.scheduleReconnect();
		};
		this.ws.onerror = (error) => {
			logger.error("Agent encountered an error:", error);
		};
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
	}
}

if (import.meta.main) {
	const agent = new Agent();

	if (process.env.ZEROBYTE_BUILTIN_LOCAL_AGENT === "1") {
		process.stdin.once("end", () => {
			agent.stop();
			setTimeout(() => process.exit(0), 5_000);
		});
		process.stdin.resume();
	}

	agent.connect();
}
