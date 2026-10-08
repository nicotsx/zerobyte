import type { ListAgentsResponse } from "~/client/api-client/types.gen";

type Agent = ListAgentsResponse[number];

export const getEffectiveMachineStatus = (agent: Pick<Agent, "revokedAt" | "status">) => {
	if (agent.revokedAt !== null) return "revoked" as const;
	return agent.status;
};

export const getControllerUrlForOrigin = (origin: string) => {
	const controllerUrl = new URL("/api/v1/agents/connect", origin);
	controllerUrl.protocol = controllerUrl.protocol === "https:" ? "wss:" : "ws:";
	return controllerUrl.toString();
};
