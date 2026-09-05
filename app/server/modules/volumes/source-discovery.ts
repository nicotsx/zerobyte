import { and, eq, inArray, isNull, or } from "drizzle-orm";
import { type SourceLocation, type SourceMachine } from "@zerobyte/contracts/volumes";
import { ConflictError, NotFoundError, ServiceUnavailableError } from "http-errors-enhanced";
import {
	ALLOWED_LOCATION_LABEL,
	getSafeMachinePresentationLabel,
	UNAVAILABLE_MACHINE_LABEL,
} from "~/lib/safe-presentation-label";
import { db } from "~/server/db/db";
import { agentsTable, type Agent, type Volume } from "~/server/db/schema";
import { agentManager } from "../agents/agents-manager";
import { parseTrustedRootsCompatibility } from "../agents/agent-capability-presentation";
import { LOCAL_AGENT_ID } from "../agents/constants";

export { parseTrustedRootsCompatibility } from "../agents/agent-capability-presentation";
export type { TrustedRootsCompatibility } from "../agents/agent-capability-presentation";

const getMachineAvailability = (agent: Agent, compatible: boolean, ready: boolean): SourceLocation["availability"] => {
	if (agent.revokedAt !== null) return "revoked";
	if (!compatible) return "incompatible";
	if (agent.status !== "online") return agent.status;
	return ready ? "available" : "not-ready";
};

const getSafeMachineName = (name: string) => {
	const safeName = getSafeMachinePresentationLabel(name);

	return safeName.slice(0, 100);
};

const toSourceMachine = async (agent: Agent): Promise<SourceMachine> => {
	const name = getSafeMachineName(agent.name);
	const compatibility = parseTrustedRootsCompatibility(agent.capabilities);
	const trustedRoots = compatibility.trustedRoots;
	const ready = agent.status === "online" && (await agentManager.isAgentReady(agent.id));
	const availability = getMachineAvailability(agent, compatibility.compatible, ready);

	return {
		availability,
		id: agent.id,
		name,
		status: agent.status,
		lastSeenAt: agent.lastSeenAt,
		revokedAt: agent.revokedAt,
		trustedRoots,
	};
};

export const listSourceMachines = async (organizationId: string) => {
	const agents = await db.query.agentsTable.findMany({
		where: { AND: [{ organizationId: { eq: organizationId } }, { kind: { eq: "remote" } }] },
		orderBy: { createdAt: "asc" },
	});

	return Promise.all(agents.map(toSourceMachine));
};

export const getActionableTrustedRoot = async (agentId: string, rootId: string, organizationId: string) => {
	const agent = await db.query.agentsTable.findFirst({
		where: { AND: [{ id: { eq: agentId } }, { organizationId: { eq: organizationId } }] },
	});

	if (!agent || agent.kind !== "remote") {
		throw new NotFoundError("Source machine not found");
	}

	if (agent.revokedAt !== null) {
		throw new ConflictError(`Source machine "${getSafeMachineName(agent.name)}" is revoked`);
	}
	if (agent.status !== "online") {
		throw new ServiceUnavailableError(`Source machine "${getSafeMachineName(agent.name)}" is ${agent.status}`);
	}

	const compatibility = parseTrustedRootsCompatibility(agent.capabilities);

	if (!compatibility.compatible) {
		throw new ConflictError("Source machine capabilities are incompatible");
	}

	const isReady = await agentManager.isAgentReady(agent.id);

	if (!isReady) {
		throw new ServiceUnavailableError(`Source machine "${getSafeMachineName(agent.name)}" is not connected`);
	}

	const trustedRoots = compatibility.trustedRoots;
	const root = trustedRoots.find((candidate) => candidate.id === rootId);

	if (!root) {
		throw new ConflictError(`Trusted root "${rootId}" is not advertised by the source machine`);
	}
	if (!root.canBackup) {
		throw new ConflictError(`Trusted root "${root.label}" does not allow backups`);
	}

	return root;
};

export type SourceLocationPresentationContext = {
	agentsById: ReadonlyMap<string, Agent>;
	readinessByAgentId: ReadonlyMap<string, boolean>;
};

const isBuiltInLocalAgent = (agent: Agent) =>
	agent.id === LOCAL_AGENT_ID && agent.kind === "local" && agent.organizationId === null;

const isPresentableSourceAgent = (agent: Agent) => agent.kind === "remote" || isBuiltInLocalAgent(agent);

const needsReadiness = (agent: Agent, rootId: string) => {
	if (!isPresentableSourceAgent(agent) || agent.revokedAt !== null || agent.status !== "online") {
		return false;
	}
	const compatibility = parseTrustedRootsCompatibility(agent.capabilities);

	if (!compatibility.compatible) {
		return false;
	}

	const root = compatibility.trustedRoots.find((candidate) => candidate.id === rootId);
	return root?.canBackup === true;
};

export const loadSourceLocationPresentationContext = async (
	volumes: Volume[],
	organizationId: string,
): Promise<SourceLocationPresentationContext> => {
	const agentIds = [
		...new Set(
			volumes.filter((volume) => volume.sourceKind === "agent-filesystem").map((volume) => volume.agentId),
		),
	];

	if (agentIds.length === 0) {
		return { agentsById: new Map(), readinessByAgentId: new Map() };
	}
	const agents = await db
		.select()
		.from(agentsTable)
		.where(
			and(
				inArray(agentsTable.id, agentIds),
				or(
					and(eq(agentsTable.kind, "remote"), eq(agentsTable.organizationId, organizationId)),
					and(
						eq(agentsTable.id, LOCAL_AGENT_ID),
						eq(agentsTable.kind, "local"),
						isNull(agentsTable.organizationId),
					),
				),
			),
		);

	const agentsById = new Map(agents.map((agent) => [agent.id, agent]));

	const relevantAgentIds = [
		...new Set(
			volumes.flatMap((volume) => {
				if (volume.sourceKind !== "agent-filesystem") {
					return [];
				}
				const agent = agentsById.get(volume.agentId);
				const rootId = volume.trustedRootId ?? "unavailable";
				return agent && needsReadiness(agent, rootId) ? [agent.id] : [];
			}),
		),
	];

	const readinessEntries = await Promise.all(
		relevantAgentIds.map(async (agentId) => {
			const isReady = await agentManager.isAgentReady(agentId);
			return [agentId, isReady] as const;
		}),
	);

	const readinessByAgentId = new Map(readinessEntries);

	return { agentsById, readinessByAgentId };
};

export const presentSourceLocation = (volume: Volume, context: SourceLocationPresentationContext): SourceLocation => {
	const relativePath = volume.relativePath ?? "";
	const rootId = volume.trustedRootId ?? "unavailable";
	const agent = context.agentsById.get(volume.agentId);

	if (!agent || !isPresentableSourceAgent(agent)) {
		return {
			machine: {
				id: volume.agentId,
				name: UNAVAILABLE_MACHINE_LABEL,
				status: "offline",
				lastSeenAt: null,
				revokedAt: null,
			},
			root: { id: rootId, label: ALLOWED_LOCATION_LABEL, canBackup: false },
			relativePath,
			availability: "missing-agent",
		};
	}

	const compatibility = parseTrustedRootsCompatibility(agent.capabilities);
	const trustedRoots = compatibility.trustedRoots;
	const root = trustedRoots.find((candidate) => candidate.id === rootId);
	const missingRoot = { id: rootId, label: ALLOWED_LOCATION_LABEL, canBackup: false };
	const presentedRoot = root ?? missingRoot;

	let availability: SourceLocation["availability"];

	if (agent.revokedAt !== null) {
		availability = "revoked";
	} else if (!compatibility.compatible) {
		availability = "incompatible";
	} else if (!root) {
		availability = "root-removed";
	} else if (!root.canBackup) {
		availability = "backup-disabled";
	} else if (agent.status !== "online") {
		availability = agent.status;
	} else {
		const isReady = context.readinessByAgentId.get(agent.id) ?? false;
		availability = isReady ? "available" : "not-ready";
	}

	return {
		machine: {
			id: agent.id,
			name: getSafeMachineName(agent.name),
			status: agent.status,
			lastSeenAt: agent.lastSeenAt,
			revokedAt: agent.revokedAt,
		},
		root: presentedRoot,
		relativePath,
		availability,
	};
};
