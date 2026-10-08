import { logger } from "@zerobyte/core/node";
import { agentManager } from "./agents-manager";
import { agentsService } from "./agents.service";

type EnrollmentPersistence = Pick<
	typeof agentsService,
	"createRemoteAgent" | "rotateRemoteAgentToken" | "revokeRemoteAgentToken"
>;

export type AgentDisconnectPort = {
	disconnectAgent: (agentId: string) => Promise<boolean>;
};

export const createAgentEnrollmentService = (
	persistence: EnrollmentPersistence,
	disconnectPort: AgentDisconnectPort,
) => {
	const disconnectCommittedAgent = async (agentId: string) => {
		try {
			return await disconnectPort.disconnectAgent(agentId);
		} catch {
			logger.warn(`Failed to disconnect agent ${agentId} after enrollment mutation`);
			return false;
		}
	};

	return {
		createRemoteAgent: (organizationId: string, name: string) =>
			persistence.createRemoteAgent(organizationId, name),
		rotateRemoteAgentToken: async (organizationId: string, agentId: string) => {
			const rotation = await persistence.rotateRemoteAgentToken(organizationId, agentId);

			await disconnectCommittedAgent(agentId);
			return rotation;
		},
		revokeRemoteAgentToken: async (organizationId: string, agentId: string) => {
			const revoked = await persistence.revokeRemoteAgentToken(organizationId, agentId);

			await disconnectCommittedAgent(agentId);
			return revoked;
		},
	};
};

const runtimeDisconnectPort: AgentDisconnectPort = {
	disconnectAgent: (agentId) => agentManager.disconnectAgent(agentId),
};

export const agentEnrollmentService = createAgentEnrollmentService(agentsService, runtimeDisconnectPort);
