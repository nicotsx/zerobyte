import { eq } from "drizzle-orm";
import { db } from "../../db/db";
import { agentsTable, type Agent, type AgentCapabilities, type AgentKind } from "../../db/schema";
import { LOCAL_AGENT_CAPABILITIES, LOCAL_AGENT_ID, LOCAL_AGENT_KIND, LOCAL_AGENT_NAME } from "./constants";

type AgentConnectionRegistration = {
	agentId: string;
	organizationId: string | null;
	agentName: string;
	agentKind: AgentKind;
	capabilities?: AgentCapabilities;
	connectedAt?: number;
};

const listAgents = async (organizationId?: string | null) => {
	if (organizationId === undefined) {
		return db.query.agentsTable.findMany({ orderBy: { createdAt: "asc" } });
	}

	if (organizationId === null) {
		return db.query.agentsTable.findMany({
			where: { organizationId: { isNull: true } },
			orderBy: { createdAt: "asc" },
		});
	}

	return db.query.agentsTable.findMany({
		where: { organizationId },
		orderBy: { createdAt: "asc" },
	});
};

const getAgent = async (agentId: string) => {
	return db.query.agentsTable.findFirst({ where: { id: agentId } });
};

const ensureLocalAgent = async () => {
	const existing = await getAgent(LOCAL_AGENT_ID);

	if (existing) {
		return existing;
	}

	await db.insert(agentsTable).values({
		id: LOCAL_AGENT_ID,
		organizationId: null,
		name: LOCAL_AGENT_NAME,
		kind: LOCAL_AGENT_KIND,
		status: "offline",
		capabilities: LOCAL_AGENT_CAPABILITIES,
		updatedAt: Date.now(),
	});

	return getAgent(LOCAL_AGENT_ID);
};

const markAgentConnecting = async (params: AgentConnectionRegistration) => {
	const { agentId, organizationId, agentName, agentKind, capabilities, connectedAt = Date.now() } = params;

	await db
		.insert(agentsTable)
		.values({
			id: agentId,
			organizationId,
			name: agentName,
			kind: agentKind,
			status: "connecting",
			capabilities: capabilities ?? {},
			lastSeenAt: connectedAt,
			updatedAt: connectedAt,
		})
		.onConflictDoUpdate({
			target: agentsTable.id,
			set: {
				organizationId,
				name: agentName,
				kind: agentKind,
				status: "connecting",
				lastSeenAt: connectedAt,
				updatedAt: connectedAt,
				capabilities: capabilities ?? {},
			},
		});

	return getAgent(agentId);
};

const updateAgentRuntime = async (agentId: string, values: Partial<Agent>) => {
	const [updatedAgent] = await db.update(agentsTable).set(values).where(eq(agentsTable.id, agentId)).returning();

	if (!updatedAgent) {
		throw new Error(`Agent ${agentId} not found`);
	}

	return updatedAgent;
};

const markAgentOnline = async (agentId: string, readyAt = Date.now()) => {
	return updateAgentRuntime(agentId, {
		status: "online",
		lastSeenAt: readyAt,
		lastReadyAt: readyAt,
		updatedAt: readyAt,
	});
};

const markAgentSeen = async (agentId: string, seenAt = Date.now()) => {
	return updateAgentRuntime(agentId, {
		lastSeenAt: seenAt,
		updatedAt: seenAt,
	});
};

const markAgentOffline = async (agentId: string, disconnectedAt = Date.now()) => {
	return updateAgentRuntime(agentId, {
		status: "offline",
		updatedAt: disconnectedAt,
	});
};

export const agentsService = {
	listAgents,
	getAgent,
	ensureLocalAgent,
	markAgentConnecting,
	markAgentOnline,
	markAgentSeen,
	markAgentOffline,
};
