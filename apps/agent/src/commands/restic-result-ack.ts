import { Effect, Queue } from "effect";
import { type ResticCommandResultAckPayload } from "@zerobyte/contracts/agent-protocol";
import type { ControllerCommandContext } from "../context";

export const handleResticResultAckCommand = (
	context: ControllerCommandContext,
	payload: ResticCommandResultAckPayload,
) => {
	return Effect.gen(function* () {
		const running = yield* context.getRunningJob(payload.commandId);

		// The command may have been cancelled or finished since the chunk was sent.
		if (running?.kind !== "restic") return;

		yield* Queue.offer(running.resultAcks, undefined);
	});
};
