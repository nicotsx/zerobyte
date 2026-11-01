import type { ControllerMessage } from "@zerobyte/contracts/agent-protocol";
import type { ControllerCommandContext } from "../context";

type HeartbeatPingPayload = Extract<ControllerMessage, { type: "heartbeat.ping" }>["payload"];

export const handleHeartbeatPingCommand = (context: ControllerCommandContext, payload: HeartbeatPingPayload) => {
	return context.offerOutbound({
		type: "heartbeat.pong",
		payload: {
			sentAt: payload.sentAt,
		},
	});
};
