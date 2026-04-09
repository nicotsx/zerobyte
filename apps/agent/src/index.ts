import { logger } from "@zerobyte/core/node";
import { createControllerSession, type ControllerSession } from "./controller-session";

const controllerUrl = process.env.ZEROBYTE_CONTROLLER_URL;
const agentToken = process.env.ZEROBYTE_AGENT_TOKEN;
const RECONNECT_DELAY_MS = 1000;

class Agent {
	private ws: WebSocket | null = null;
	private controllerSession: ControllerSession | null = null;
	private reconnectTimeout: ReturnType<typeof setTimeout> | null = null;

	private scheduleReconnect() {
		if (this.reconnectTimeout) {
			return;
		}

		this.reconnectTimeout = setTimeout(() => {
			this.reconnectTimeout = null;
			this.connect();
		}, RECONNECT_DELAY_MS);
	}

	connect() {
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
}

if (import.meta.main) {
	const agent = new Agent();
	agent.connect();
}
