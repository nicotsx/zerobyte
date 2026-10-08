import { and, eq, gt, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import type { SQLiteUpdateSetSource } from "drizzle-orm/sqlite-core";
import { ConflictError, NotFoundError, UnauthorizedError } from "http-errors-enhanced";
import { toAgentConnectionUrl } from "@zerobyte/contracts/agent-connection";
import { db } from "../../db/db";
import { agentsTable, volumesTable, type Agent, type AgentCapabilities } from "../../db/schema";
import { config } from "../../core/config";
import { LOCAL_AGENT_CAPABILITIES, LOCAL_AGENT_ID, LOCAL_AGENT_KIND, LOCAL_AGENT_NAME } from "./constants";
import { createAgentToken, hashAgentToken, parseAgentToken, type AgentIdentity } from "./helpers/tokens";
import { publicAgentSchema } from "./agents.dto";
import { presentAgentCapabilities } from "./agent-capability-presentation";

const ENROLLMENT_LIFETIME_MS = 15 * 60 * 1000;

type AgentCredential = Pick<AgentIdentity, "agentId" | "credentialVersion">;
type AgentRuntimeUpdate = Partial<Pick<Agent, "status" | "capabilities" | "lastSeenAt" | "lastReadyAt" | "updatedAt">>;

const presentAgent = (agent: Agent) =>
	publicAgentSchema.parse({ ...agent, capabilities: presentAgentCapabilities(agent.capabilities) });

const listOrganizationAgents = async (organizationId: string) => {
	const rows = await db.query.agentsTable.findMany({
		where: { OR: [{ kind: "local" }, { AND: [{ organizationId }, { kind: "remote" }] }] },
		orderBy: { createdAt: "asc" },
	});

	return rows.map(presentAgent);
};

const getAgent = async (agentId: string) => db.query.agentsTable.findFirst({ where: { id: agentId } });

const getOrganizationRemoteAgent = async (organizationId: string, agentId: string) => {
	const agent = await db.query.agentsTable.findFirst({
		where: { AND: [{ id: agentId }, { organizationId }, { kind: "remote" }] },
	});

	if (!agent) throw new NotFoundError("Remote agent not found");

	return agent;
};

const ensureLocalAgent = async () => {
	const existing = await getAgent(LOCAL_AGENT_ID);

	if (existing) return existing;

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

const getControllerUrl = () => toAgentConnectionUrl(config.baseUrl).toString();

const createRemoteAgent = async (organizationId: string, name: string) => {
	const id = Bun.randomUUIDv7();
	const credentialVersion = 1;
	const credentials = await createAgentToken(id, credentialVersion);

	const now = Date.now();
	const expiresAt = now + ENROLLMENT_LIFETIME_MS;

	const [agent] = await db
		.insert(agentsTable)
		.values({
			id,
			organizationId,
			name: name.trim(),
			kind: "remote",
			status: "offline",
			capabilities: {},
			credentialHash: credentials.credentialHash,
			enrollmentExpiresAt: expiresAt,
			credentialVersion,
			revokedAt: null,
			updatedAt: now,
		})
		.returning();

	if (!agent) throw new Error("Failed to create remote agent");

	return { agent: presentAgent(agent), controllerUrl: getControllerUrl(), token: credentials.token, expiresAt };
};

const updateRemoteAgent = async (
	organizationId: string,
	agentId: string,
	values: SQLiteUpdateSetSource<typeof agentsTable>,
	expectedCredentialVersion?: number,
) => {
	let credentialVersionCondition;
	if (expectedCredentialVersion !== undefined) {
		credentialVersionCondition = eq(agentsTable.credentialVersion, expectedCredentialVersion);
	}

	const [updated] = await db
		.update(agentsTable)
		.set(values)
		.where(
			and(
				eq(agentsTable.id, agentId),
				eq(agentsTable.organizationId, organizationId),
				eq(agentsTable.kind, "remote"),
				credentialVersionCondition,
			),
		)
		.returning();

	return updated && presentAgent(updated);
};

const rotateRemoteAgentToken = async (organizationId: string, agentId: string) => {
	const agent = await getOrganizationRemoteAgent(organizationId, agentId);
	const credentialVersion = agent.credentialVersion + 1;
	const credentials = await createAgentToken(agent.id, credentialVersion);

	const now = Date.now();
	const expiresAt = now + ENROLLMENT_LIFETIME_MS;

	// The version fences live connections, so a stale rotation must never move it backwards.
	const updated = await updateRemoteAgent(
		organizationId,
		agentId,
		{
			credentialHash: credentials.credentialHash,
			enrollmentExpiresAt: expiresAt,
			credentialVersion,
			revokedAt: null,
			status: "offline",
			updatedAt: now,
		},
		agent.credentialVersion,
	);

	if (!updated) throw new ConflictError("The agent credential changed during rotation. Try again.");

	return { agent: updated, controllerUrl: getControllerUrl(), token: credentials.token, expiresAt };
};

const revokeRemoteAgentToken = async (organizationId: string, agentId: string) => {
	const now = Date.now();

	const revoked = await updateRemoteAgent(organizationId, agentId, {
		credentialHash: null,
		enrollmentExpiresAt: null,
		credentialVersion: sql`${agentsTable.credentialVersion} + 1`,
		revokedAt: now,
		status: "offline",
		updatedAt: now,
	});

	if (!revoked) throw new NotFoundError("Remote agent not found");

	return revoked;
};

const deleteRemoteAgent = (organizationId: string, agentId: string) =>
	db.transaction((tx) => {
		const source = tx
			.select({ id: volumesTable.id })
			.from(volumesTable)
			.where(and(eq(volumesTable.agentId, agentId), eq(volumesTable.organizationId, organizationId)))
			.get();

		if (source) throw new ConflictError("Delete this machine's sources before deleting the machine.");

		const deleted = tx
			.delete(agentsTable)
			.where(
				and(
					eq(agentsTable.id, agentId),
					eq(agentsTable.organizationId, organizationId),
					eq(agentsTable.kind, "remote"),
				),
			)
			.returning({ id: agentsTable.id })
			.get();

		if (!deleted) throw new NotFoundError("Remote agent not found");
	});

const exchangeEnrollmentToken = async (token: string) => {
	const parsed = parseAgentToken(token);

	if (!parsed) throw new UnauthorizedError("Invalid or expired enrollment code");

	const providedHash = await hashAgentToken(token);
	const credentialVersion = parsed.credentialVersion + 1;
	const credential = await createAgentToken(parsed.agentId, credentialVersion);
	const now = Date.now();

	const [agent] = await db
		.update(agentsTable)
		.set({
			credentialHash: credential.credentialHash,
			credentialVersion,
			enrollmentExpiresAt: null,
			updatedAt: now,
		})
		.where(
			and(
				eq(agentsTable.id, parsed.agentId),
				eq(agentsTable.kind, "remote"),
				isNotNull(agentsTable.organizationId),
				isNull(agentsTable.revokedAt),
				eq(agentsTable.credentialVersion, parsed.credentialVersion),
				eq(agentsTable.credentialHash, providedHash),
				gt(agentsTable.enrollmentExpiresAt, now),
			),
		)
		.returning();

	if (!agent) throw new UnauthorizedError("Invalid or expired enrollment code");

	return { token: credential.token };
};

const updateAgentRuntime = async ({ agentId, credentialVersion }: AgentCredential, values: AgentRuntimeUpdate) => {
	const [agent] = await db
		.update(agentsTable)
		.set(values)
		.where(and(eq(agentsTable.id, agentId), eq(agentsTable.credentialVersion, credentialVersion)))
		.returning();

	return agent;
};

const markAgentConnecting = async (credential: AgentCredential) => {
	const now = Date.now();

	return updateAgentRuntime(credential, { status: "connecting", lastSeenAt: now, updatedAt: now });
};

const markAgentOnline = async (credential: AgentCredential, capabilities: AgentCapabilities, readyAt = Date.now()) =>
	updateAgentRuntime(credential, {
		status: "online",
		capabilities,
		lastSeenAt: readyAt,
		lastReadyAt: readyAt,
		updatedAt: readyAt,
	});

const markAgentSeen = async (credential: AgentCredential, seenAt = Date.now()) =>
	updateAgentRuntime(credential, { lastSeenAt: seenAt, updatedAt: seenAt });

const markAgentOffline = async (credential: AgentCredential, disconnectedAt = Date.now()) =>
	updateAgentRuntime(credential, { status: "offline", updatedAt: disconnectedAt });

const markStaleRemoteAgentsOffline = async () => {
	const now = Date.now();

	return db
		.update(agentsTable)
		.set({ status: "offline", updatedAt: now })
		.where(and(eq(agentsTable.kind, "remote"), inArray(agentsTable.status, ["online", "connecting"])))
		.returning();
};

export const agentsService = {
	deleteRemoteAgent,
	exchangeEnrollmentToken,
	listOrganizationAgents,
	getAgent,
	ensureLocalAgent,
	createRemoteAgent,
	rotateRemoteAgentToken,
	revokeRemoteAgentToken,
	markAgentConnecting,
	markAgentOnline,
	markAgentSeen,
	markAgentOffline,
	markStaleRemoteAgentsOffline,
};
