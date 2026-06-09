import { logger, webSocketRawDataToString } from "@zerobyte/core/node";
import { Fiber } from "effect";
import WebSocket from "ws";
import { createControllerSession, type ControllerSession } from "./controller-session";
import { startAgentJobs } from "./jobs";

const controllerUrl = process.env.ZEROBYTE_CONTROLLER_URL;
const agentToken = process.env.ZEROBYTE_AGENT_TOKEN;
const RECONNECT_DELAY_MS = 1000;

export class Agent {
	private ws: WebSocket | null = null;
	private controllerSession: ControllerSession | null = null;
	private reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
	private jobFibers: Fiber.RuntimeFiber<never, never>[] | null = null;

	private startJobs() {
		if (this.jobFibers) {
			return;
		}

		this.jobFibers = startAgentJobs();
	}

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
		this.startJobs();

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

		this.ws.on("open", () => {
			logger.info("Agent connected to controller");
			this.controllerSession?.onOpen();
		});

		this.ws.on("message", (data, isBinary) => {
			this.controllerSession?.onMessage(isBinary ? data : webSocketRawDataToString(data));
		});
		this.ws.on("close", () => {
			this.controllerSession?.close();
			this.controllerSession = null;
			this.ws = null;
			logger.info("Agent disconnected from controller");
			this.scheduleReconnect();
		});
		this.ws.on("error", (error) => {
			logger.error("Agent encountered an error:", error);
		});
	}
}

if (import.meta.main) {
	const agent = new Agent();
	agent.connect();
}
