import { createAgentMessage, parseControllerMessage, sendAgentMessage } from "@zerobyte/contracts/agent-protocol";
import { logger } from "@zerobyte/core/utils";

const controllerUrl = process.env.ZEROBYTE_CONTROLLER_URL;
const agentToken = process.env.ZEROBYTE_AGENT_TOKEN;

class Agent {
	private ws: WebSocket | null = null;

	connect() {
		if (!controllerUrl) {
			throw new Error("Env variable ZEROBYTE_CONTROLLER_URL is not set");
		}

		if (!agentToken) {
			throw new Error("Env variable ZEROBYTE_AGENT_TOKEN is not set");
		}

		const url = new URL(controllerUrl);
		url.searchParams.set("token", agentToken);

		this.ws = new WebSocket(url.toString());
		this.ws.onopen = () => {
			logger.info("Agent connected to controller");

			if (this.ws) {
				sendAgentMessage(this.ws, createAgentMessage("agent.ready", { agentId: "" }));
			}
		};

		this.ws.onmessage = (event) => {
			const parsed = parseControllerMessage(event.data);

			if (parsed === null) {
				console.error("Agent received invalid JSON");
				return;
			}

			if (!parsed.success) {
				console.error(`Agent received an invalid message: ${parsed.error.message}`);
				return;
			}

			switch (parsed.data.type) {
				case "backup":
					logger.info(`Starting backup for schedule ${parsed.data.payload.scheduleId}`);
					if (this.ws) {
						sendAgentMessage(
							this.ws,
							createAgentMessage("backup.started", { scheduleId: parsed.data.payload.scheduleId }),
						);
					}
					break;
			}
		};
		this.ws.onclose = () => {
			logger.info("Agent disconnected from controller");
		};
		this.ws.onerror = (error) => {
			logger.error("Agent encountered an error:", error);
		};
	}
}

const agent = new Agent();
agent.connect();
