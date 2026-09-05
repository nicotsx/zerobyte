import { and, eq, gt, inArray, isNotNull, isNull } from "drizzle-orm";
import { ConflictError, NotFoundError, UnauthorizedError } from "http-errors-enhanced";
import { db } from "../../db/db";
import { agentsTable, volumesTable, type Agent, type AgentCapabilities, type AgentKind } from "../../db/schema";
import { config } from "../../core/config";
import { presentAgentCapabilities, type PublicAgentCapabilities } from "./agent-capability-presentation";
import { LOCAL_AGENT_CAPABILITIES, LOCAL_AGENT_ID, LOCAL_AGENT_KIND, LOCAL_AGENT_NAME } from "./constants";
import { createEnrollmentToken, parseEnrollmentToken, hashTokenParts } from "./helpers/tokens";

const ENROLLMENT_LIFETIME_MS = 15 * 60 * 1000;

const MAX_CREDENTIAL_VERSION = 2_147_483_647;

type AgentConnectionRegistration = {
	agentId: string;
	organizationId: string | null;
	agentName: string;
	agentKind: AgentKind;
	credentialVersion: number;
	capabilities?: AgentCapabilities;
	connectedAt?: number;
};

export type PublicAgent = {
	id: string;
	organizationId: string | null;
	name: string;
	kind: AgentKind;
	status: Agent["status"];
	capabilities: PublicAgentCapabilities;
	lastSeenAt: number | null;
	lastReadyAt: number | null;
	createdAt: number;
	updatedAt: number;
	revokedAt: number | null;
	credentialVersion: number;
};

const presentAgent = (agent: Agent): PublicAgent => {
	const capabilities = presentAgentCapabilities(agent.capabilities);

	const presented = {
		id: agent.id,
		organizationId: agent.organizationId,
		name: agent.name,
		kind: agent.kind,
		status: agent.status,
		capabilities,
		lastSeenAt: agent.lastSeenAt,
		lastReadyAt: agent.lastReadyAt,
		createdAt: agent.createdAt,
		updatedAt: agent.updatedAt,
		revokedAt: agent.revokedAt,
		credentialVersion: agent.credentialVersion,
	};
	return presented;
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

	return db.query.agentsTable.findMany({ where: { organizationId }, orderBy: { createdAt: "asc" } });
};

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

	if (!agent) {
		throw new NotFoundError("Remote agent not found");
	}

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

const createRemoteAgent = async (organizationId: string, name: string) => {
	const trimmedName = name.trim();
	const id = Bun.randomUUIDv7();
	const credentialVersion = 1;
	const credentials = await createEnrollmentToken(id, credentialVersion);
	const now = Date.now();

	const [agent] = await db
		.insert(agentsTable)
		.values({
			id,
			organizationId,
			name: trimmedName,
			kind: "remote",
			status: "offline",
			capabilities: {},
			credentialHash: credentials.credentialHash,
			enrollmentExpiresAt: now + ENROLLMENT_LIFETIME_MS,
			credentialVersion,
			revokedAt: null,
			updatedAt: now,
		})
		.returning();

	if (!agent) throw new Error("Failed to create remote agent");

	const httpUrl = new URL("/api/v1/agents/connect", config.baseUrl);
	const controllerProtocol = httpUrl.protocol === "https:" ? "wss:" : "ws:";

	httpUrl.protocol = controllerProtocol;
	return {
		agent: presentAgent(agent),
		controllerUrl: httpUrl.toString(),
		token: credentials.token,
		expiresAt: now + ENROLLMENT_LIFETIME_MS,
	};
};

const nextCredentialVersion = (currentVersion: number) => {
	const canAdvance =
		Number.isSafeInteger(currentVersion) && currentVersion >= 0 && currentVersion < MAX_CREDENTIAL_VERSION;

	if (!canAdvance) throw new ConflictError("Remote agent credential version cannot be advanced");
	return currentVersion + 1;
};

const rotateRemoteAgentToken = async (organizationId: string, agentId: string) => {
	const agent = await getOrganizationRemoteAgent(organizationId, agentId);
	const credentialVersion = nextCredentialVersion(agent.credentialVersion);
	const credentials = await createEnrollmentToken(agent.id, credentialVersion);
	const now = Date.now();

	const rotationScope = and(
		eq(agentsTable.id, agentId),
		eq(agentsTable.organizationId, organizationId),
		eq(agentsTable.kind, "remote"),
		eq(agentsTable.credentialVersion, agent.credentialVersion),
	);

	const [updated] = await db
		.update(agentsTable)
		.set({
			credentialHash: credentials.credentialHash,
			enrollmentExpiresAt: now + ENROLLMENT_LIFETIME_MS,
			credentialVersion,
			revokedAt: null,
			status: "offline",
			updatedAt: now,
		})
		.where(rotationScope)
		.returning();

	if (!updated) throw new ConflictError("Remote agent credential changed; retry rotation");
	return { agent: presentAgent(updated), token: credentials.token, expiresAt: now + ENROLLMENT_LIFETIME_MS };
};

const revokeRemoteAgentToken = async (organizationId: string, agentId: string) => {
	const agent = await getOrganizationRemoteAgent(organizationId, agentId);
	const credentialVersion = nextCredentialVersion(agent.credentialVersion);
	const now = Date.now();

	const revocationScope = and(
		eq(agentsTable.id, agentId),
		eq(agentsTable.organizationId, organizationId),
		eq(agentsTable.kind, "remote"),
		eq(agentsTable.credentialVersion, agent.credentialVersion),
	);

	const [updated] = await db
		.update(agentsTable)
		.set({
			credentialHash: null,
			enrollmentExpiresAt: null,
			credentialVersion,
			revokedAt: now,
			status: "offline",
			updatedAt: now,
		})
		.where(revocationScope)
		.returning();

	if (!updated) throw new ConflictError("Remote agent credential changed; retry revocation");
	return presentAgent(updated);
};

const deleteRemoteAgent = async (organizationId: string, agentId: string) => {
	await getOrganizationRemoteAgent(organizationId, agentId);

	db.transaction((tx) => {
		const source = tx
			.select({ id: volumesTable.id })
			.from(volumesTable)
			.where(eq(volumesTable.agentId, agentId))
			.get();

		if (source) throw new ConflictError("Delete this machine's sources before deleting the machine.");

		tx.delete(agentsTable)
			.where(
				and(
					eq(agentsTable.id, agentId),
					eq(agentsTable.organizationId, organizationId),
					eq(agentsTable.kind, "remote"),
				),
			)
			.run();
	});
};

const markAgentConnecting = async (params: AgentConnectionRegistration) => {
	const {
		agentId,
		organizationId,
		agentName,
		agentKind,
		credentialVersion,
		capabilities,
		connectedAt = Date.now(),
	} = params;

	const updateValues: Partial<Agent> = { status: "connecting", lastSeenAt: connectedAt, updatedAt: connectedAt };
	if (capabilities !== undefined) updateValues.capabilities = capabilities;

	const identityScope = and(
		eq(agentsTable.id, agentId),
		eq(agentsTable.name, agentName),
		eq(agentsTable.kind, agentKind),
		eq(agentsTable.credentialVersion, credentialVersion),
	);
	const remoteScope = organizationId
		? and(
				identityScope,
				eq(agentsTable.organizationId, organizationId),
				isNull(agentsTable.revokedAt),
				isNotNull(agentsTable.credentialHash),
			)
		: undefined;
	const registrationScope =
		agentKind === "remote" ? remoteScope : and(identityScope, isNull(agentsTable.organizationId));

	if (!registrationScope) throw new Error(`Agent ${agentId} enrollment changed`);

	const [updatedAgent] = await db.update(agentsTable).set(updateValues).where(registrationScope).returning();

	if (!updatedAgent) throw new Error(`Agent ${agentId} enrollment changed`);
	return updatedAgent;
};

const updateAgentRuntime = async (agentId: string, values: Partial<Agent>, credentialVersion?: number) => {
	const updateScope =
		credentialVersion === undefined
			? eq(agentsTable.id, agentId)
			: and(eq(agentsTable.id, agentId), eq(agentsTable.credentialVersion, credentialVersion));

	const [updatedAgent] = await db.update(agentsTable).set(values).where(updateScope).returning();

	if (!updatedAgent && credentialVersion === undefined) throw new Error(`Agent ${agentId} not found`);
	return updatedAgent;
};

const markAgentOnline = async (
	agentId: string,
	readyAt = Date.now(),
	metadata?: AgentCapabilities,
	credentialVersion?: number,
) =>
	updateAgentRuntime(
		agentId,
		{
			status: "online",
			capabilities: metadata,
			lastSeenAt: readyAt,
			lastReadyAt: readyAt,
			updatedAt: readyAt,
		},
		credentialVersion,
	);
const markAgentSeen = async (agentId: string, seenAt = Date.now(), credentialVersion?: number) =>
	updateAgentRuntime(agentId, { lastSeenAt: seenAt, updatedAt: seenAt }, credentialVersion);
const markAgentOffline = async (agentId: string, disconnectedAt = Date.now(), credentialVersion?: number) =>
	updateAgentRuntime(agentId, { status: "offline", updatedAt: disconnectedAt }, credentialVersion);
const markStaleRemoteAgentsOffline = async () => {
	const now = Date.now();

	return db
		.update(agentsTable)
		.set({ status: "offline", updatedAt: now })
		.where(and(eq(agentsTable.kind, "remote"), inArray(agentsTable.status, ["online", "connecting"])))
		.returning();
};

// Consume the enrollment credential and publish the machine credential in one CAS update.
const exchangeEnrollmentToken = async (token: string) => {
	const parsed = parseEnrollmentToken(token);
	if (!parsed) throw new UnauthorizedError("Invalid or expired enrollment code");

	const providedHash = await hashTokenParts(parsed);
	const nextVersion = nextCredentialVersion(parsed.credentialVersion);
	const credential = await createEnrollmentToken(parsed.agentId, nextVersion);
	const now = Date.now();

	const [agent] = await db
		.update(agentsTable)
		.set({
			credentialHash: credential.credentialHash,
			credentialVersion: nextVersion,
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

export const agentsService = {
	deleteRemoteAgent,
	exchangeEnrollmentToken,
	listAgents,
	listOrganizationAgents,
	getAgent,
	getOrganizationRemoteAgent,
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
