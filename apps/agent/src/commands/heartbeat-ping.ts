import { Effect } from "effect";
import { createAgentMessage, type ControllerMessage } from "@zerobyte/contracts/agent-protocol";
import type { ControllerCommandContext } from "../context";

type HeartbeatPingPayload = Extract<ControllerMessage, { type: "heartbeat.ping" }>["payload"];

export const handleHeartbeatPingCommand = (context: ControllerCommandContext, payload: HeartbeatPingPayload) =>
	Effect.gen(function* () {
		yield* context.offerOutbound(
			createAgentMessage("heartbeat.pong", {
				sentAt: payload.sentAt,
			}),
		);
	});
