import { z } from "zod";
import { requestAgentUpdate } from "~/client/api-client/sdk.gen";
import type { ListAgentsResponse, RequestAgentUpdateData } from "~/client/api-client/types.gen";

type Agent = ListAgentsResponse[number];
const requestErrorSchema = z.object({ message: z.string().min(1) });

export class AgentUpdateRequestError extends Error {
	constructor(
		public readonly status: number | undefined,
		message: string,
	) {
		super(message);
	}
}

export async function queueAgentUpdate(options: Pick<RequestAgentUpdateData, "path" | "body">) {
	const { data, error, response } = await requestAgentUpdate({
		...options,
		signal: AbortSignal.timeout(30_000),
		throwOnError: false,
		responseStyle: "fields",
	});
	if (data) return data;

	const status = response?.status;
	const message = requestErrorSchema.safeParse(response ? error : undefined).data?.message;
	const fallback =
		status === 409
			? "The update offer changed. Close this dialog and review the current update."
			: "Could not request an agent update. Try again.";

	throw new AgentUpdateRequestError(status, message ?? fallback);
}

export const getRemoteUpdateTarget = (update: Agent["update"]) =>
	update.availability !== "none" && update.delivery === "remote" ? update.targetTag : null;

export const getMachineUpdate = (agent: Agent) => {
	if (agent.kind !== "remote" || agent.revokedAt !== null || agent.lastSeenAt === null) return null;

	return agent.update;
};

export const isAgentUpdateActive = (request: Agent["update"]["request"]) =>
	request?.status === "queued" || request?.status === "started";
