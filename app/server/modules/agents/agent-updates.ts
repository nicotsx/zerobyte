import { and, eq } from "drizzle-orm";
import { Effect } from "effect";
import {
	ConflictError,
	ForbiddenError,
	NotFoundError,
	ServiceUnavailableError,
	UnauthorizedError,
} from "http-errors-enhanced";
import type { AgentMaintenanceRequest, AgentMaintenanceResponse } from "@zerobyte/contracts/agent-maintenance";
import type { AgentReleaseManifest } from "@zerobyte/contracts/agent-release";
import { db } from "~/server/db/db";
import { agentsTable, type Agent, type AgentCapabilities } from "~/server/db/schema";
import { getAgentUpdateRelease, getAgentUpdateTag } from "./agent-update-release";
import {
	getAgentUpdateState,
	isEnrolledAgent,
	presentAgentUpdate,
	presentMaintenanceUpdate,
	transitionAgentUpdate,
} from "./agent-update-state";
import { evaluatePermission } from "~/lib/permission-policy";
import { getInstanceFeatures } from "~/server/lib/permission-service";
import { getCurrentAuthorizationMembership, type AuthorizationGrant } from "../auth/authorization-grant";
import type { AgentIdentity } from "./helpers/tokens";

const presentUpdate = (agent: Agent, release: AgentReleaseManifest | null) =>
	presentAgentUpdate(getAgentUpdateState(agent, getAgentUpdateTag()), release);

const getReleaseForAgents = (agents: Agent[]) => {
	const tag = getAgentUpdateTag();
	if (!tag) return Effect.succeed(null);

	const needsOffer = agents.some((agent) => {
		const state = getAgentUpdateState(agent, tag);

		return state.canQueue && !state.active;
	});

	return needsOffer ? getAgentUpdateRelease(tag) : Effect.succeed(null);
};

const organizationRemoteAgent = (organizationId: string, agentId: string) =>
	and(eq(agentsTable.id, agentId), eq(agentsTable.organizationId, organizationId), eq(agentsTable.kind, "remote"));

const requestUpdate = (grant: AuthorizationGrant, agentId: string, targetTag: string) =>
	Effect.gen(function* () {
		const scope = organizationRemoteAgent(grant.organizationId, agentId);
		const observed = db.select().from(agentsTable).where(scope).get();
		if (!observed) return yield* Effect.fail(new NotFoundError("Remote agent not found"));
		if (targetTag !== getAgentUpdateTag()) {
			return yield* Effect.fail(new ConflictError("The server's agent update target changed"));
		}

		const observedState = getAgentUpdateState(observed, targetTag);
		if (!observedState.canQueue) return yield* Effect.fail(ineligibleTarget());
		if (observedState.active) return presentAgentUpdate(observedState, null);

		const release = yield* getAgentUpdateRelease(targetTag);

		return db.transaction(
			(tx) => {
				const membership = getCurrentAuthorizationMembership(grant, tx);
				if (!membership) throw new UnauthorizedError("Invalid or expired session");

				const permission = evaluatePermission("agents.manage", {
					orgRole: membership.role,
					authSource: grant.kind === "api-key" ? "api-key" : grant.authSource,
					features: getInstanceFeatures(),
				});
				if (!permission.allowed) throw new ForbiddenError("Forbidden");

				const agent = tx.select().from(agentsTable).where(scope).get();
				if (!agent) throw new NotFoundError("Remote agent not found");
				if (agent.credentialVersion !== observed.credentialVersion || targetTag !== getAgentUpdateTag()) {
					throw new ConflictError("The agent credential or server update target changed");
				}

				const state = getAgentUpdateState(agent, targetTag);
				if (!state.canQueue) throw ineligibleTarget();
				if (state.active) return presentAgentUpdate(state, null);
				if (!release)
					throw new ServiceUnavailableError("No verified agent release is available for this server version");

				const updateRequest = transitionAgentUpdate(state, {
					type: "queue",
					requestId: Bun.randomUUIDv7(),
					target: release,
					now: Date.now(),
				});
				tx.update(agentsTable).set({ updateRequest }).where(scope).run();

				return presentUpdate({ ...agent, updateRequest }, release);
			},
			{ behavior: "immediate" },
		);
	});

const ineligibleTarget = () => new ConflictError("This agent is not eligible for a remote update to this release");

const maintainAgent = (identity: AgentIdentity, request: AgentMaintenanceRequest): AgentMaintenanceResponse =>
	db.transaction(
		(tx) => {
			if (identity.agentKind !== "remote") throw new UnauthorizedError("Invalid agent credential");

			const scope = and(
				organizationRemoteAgent(identity.organizationId, identity.agentId),
				eq(agentsTable.credentialVersion, identity.credentialVersion),
			);
			const agent = tx.select().from(agentsTable).where(scope).get();
			if (!agent || !isEnrolledAgent(agent)) throw new UnauthorizedError("Invalid agent credential");

			const state = getAgentUpdateState(agent, getAgentUpdateTag());
			const update = transitionAgentUpdate(state, {
				type: "maintenance",
				request,
				now: Date.now(),
				elapsed: performance.now(),
				nextRequestId: () => Bun.randomUUIDv7(),
			});
			if (update !== agent.updateRequest) {
				tx.update(agentsTable).set({ updateRequest: update }).where(scope).run();
			}

			return { update: presentMaintenanceUpdate(update) };
		},
		{ behavior: "immediate" },
	);

const reconcileAgentUpdate = (agent: Agent, readyCapabilities?: AgentCapabilities) => {
	const state = getAgentUpdateState(agent, getAgentUpdateTag());

	return readyCapabilities
		? transitionAgentUpdate(state, { type: "ready", capabilities: readyCapabilities })
		: state.update;
};

export const agentUpdates = {
	getReleaseForAgents,
	presentUpdate,
	requestUpdate,
	maintainAgent,
	reconcileAgentUpdate,
};
