import { createAgentMessage, parseControllerMessage, sendAgentMessage } from "@zerobyte/contracts/agent-protocol";
import { logger } from "@zerobyte/core/utils";

const controllerUrl = process.env.ZEROBYTE_CONTROLLER_URL;

class Agent {
	private ws: WebSocket | null = null;

	constructor(public id: string) {
		this.connect();
	}

	private connect() {
		if (!controllerUrl) {
			throw new Error("Env variable ZEROBYTE_CONTROLLER_URL is not set");
		}

		this.ws = new WebSocket(controllerUrl);
		this.ws.onopen = () => {
			logger.info(`Agent ${this.id} connected to controller`);

			if (this.ws) {
				sendAgentMessage(this.ws, createAgentMessage("agent.ready", { agentId: this.id }));
			}
		};

		this.ws.onmessage = (event) => {
			const parsed = parseControllerMessage(event.data);

			if (parsed === null) {
				console.error(`Agent ${this.id} received invalid JSON`);
				return;
			}

			if (!parsed.success) {
				console.error(`Agent ${this.id} received an invalid message: ${parsed.error.message}`);
				return;
			}

			switch (parsed.data.type) {
				case "backup":
					logger.info(`Agent ${this.id} starting backup for schedule ${parsed.data.payload.scheduleId}`);
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
			logger.info(`Agent ${this.id} disconnected from controller`);
		};
		this.ws.onerror = (error) => {
			logger.error(`Agent ${this.id} encountered an error:`, error);
		};
	}
}

new Agent(Bun.randomUUIDv7());
