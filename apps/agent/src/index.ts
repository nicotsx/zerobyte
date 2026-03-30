import { logger } from "@zerobyte/core/node";
import { createControllerSession, type ControllerSession } from "./controller-session";

const controllerUrl = process.env.ZEROBYTE_CONTROLLER_URL;
const agentToken = process.env.ZEROBYTE_AGENT_TOKEN;
const reconnectDelayMs = 1_000;

export class Agent {
	private ws: WebSocket | null = null;
	private controllerSession: ControllerSession | null = null;
	private reconnectTimeout: ReturnType<typeof setTimeout> | null = null;

	connect() {
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
		url.searchParams.set("token", agentToken);

		this.ws = new WebSocket(url.toString());
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

			if (!this.reconnectTimeout) {
				this.reconnectTimeout = setTimeout(() => {
					this.reconnectTimeout = null;
					this.connect();
				}, reconnectDelayMs);
			}
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
