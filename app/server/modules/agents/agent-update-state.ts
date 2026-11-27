import type { AgentMaintenanceRequest } from "@zerobyte/contracts/agent-maintenance";
import type { AgentReleaseManifest } from "@zerobyte/contracts/agent-release";
import { SUPPORTED_AGENT_PROTOCOL_MIN_VERSION } from "@zerobyte/contracts/agent-protocol";
import { ConflictError, GoneError } from "http-errors-enhanced";
import { gt } from "semver";
import type { AgentUpdate, ExactAttempt } from "~/server/db/agent-update";
import type { Agent, AgentCapabilities } from "~/server/db/schema";
import { getAgentVersion, isSupportedAgentProtocol } from "./agent-update-release";

const UPDATE_ATTEMPT_TIMEOUT_MS = 30 * 60 * 1000;
const leaseProcessId = Bun.randomUUIDv7();

export const isEnrolledAgent = (agent: Agent) =>
	agent.kind === "remote" && agent.revokedAt === null && agent.enrollmentExpiresAt === null && !!agent.credentialHash;

const supportsRemoteUpdate = (capabilities: AgentCapabilities) =>
	capabilities.platform === "linux" &&
	capabilities.selfUpdate === "systemd" &&
	capabilities.connectionSecurity === "secure";

function assessCapabilities(capabilities: AgentCapabilities) {
	const protocolVersion = capabilities.protocolVersion ?? null;
	const version = getAgentVersion(capabilities.agentVersion);
	const required = protocolVersion !== null && protocolVersion < SUPPORTED_AGENT_PROTOCOL_MIN_VERSION;
	const compatible = protocolVersion !== null && isSupportedAgentProtocol(protocolVersion);

	return { protocolVersion, version, required, compatible, remote: supportsRemoteUpdate(capabilities) };
}

type UpdatePolicy = ReturnType<typeof assessCapabilities>;

const canTarget = ({ version, required, compatible }: UpdatePolicy, tag: string | null): tag is string =>
	tag !== null && version !== null && (required || compatible) && gt(tag, version);

type TrialUpdate = Extract<AgentUpdate, { status: "started" | "confirming" }>;
type ActiveUpdate = TrialUpdate | Extract<AgentUpdate, { status: "queued" }>;

const isTrial = (update: AgentUpdate | null): update is TrialUpdate =>
	update?.status === "started" || update?.status === "confirming";

const isActive = (update: AgentUpdate | null): update is ActiveUpdate => update?.status === "queued" || isTrial(update);

function hasLease(update: AgentUpdate, elapsed: number) {
	if (!isTrial(update)) return false;

	// Give attempts from a previous process one lease window from server startup to recover.
	const deadline = update.lease?.processId === leaseProcessId ? update.lease.deadline : UPDATE_ATTEMPT_TIMEOUT_MS;

	return elapsed < deadline;
}

const matchesAttempt = (
	expected: Pick<AgentUpdate, "requestId" | "attemptId"> | null | undefined,
	attempt: ExactAttempt | undefined,
) => attempt !== undefined && expected?.requestId === attempt.requestId && expected.attemptId === attempt.attemptId;

const matchesBuild = (target: AgentReleaseManifest, policy: UpdatePolicy) =>
	policy.version !== null && `v${policy.version}` === target.tag && policy.protocolVersion === target.protocolVersion;

const hasLiveTrial = (agent: Pick<Agent, "status" | "capabilities">, update: AgentUpdate, policy: UpdatePolicy) =>
	agent.status === "online" &&
	policy.remote &&
	matchesBuild(update.target, policy) &&
	matchesAttempt(update, agent.capabilities.updateTrial);

type AgentTrialState = Pick<Agent, "status" | "capabilities" | "updateRequest">;

export function isAgentUpdateFenced(agent: AgentTrialState, elapsed: number) {
	const update = agent.updateRequest;

	return (
		isTrial(update) &&
		(hasLease(update, elapsed) || hasLiveTrial(agent, update, assessCapabilities(agent.capabilities)))
	);
}

function reconcile(
	agent: AgentTrialState,
	policy: UpdatePolicy,
	serverTag: string | null,
	elapsed: number,
): AgentUpdate | null {
	const update = agent.updateRequest;
	if (!isActive(update)) return update;
	if (isTrial(update) && (hasLease(update, elapsed) || hasLiveTrial(agent, update, policy))) return update;

	const { requestId, target, requestedAt, attemptId, previousAttempt } = update;
	if (update.status === "confirming") {
		if (agent.status !== "online") return update;
	} else if (
		policy.remote &&
		target.tag === serverTag &&
		canTarget(policy, serverTag) &&
		isSupportedAgentProtocol(target.protocolVersion)
	) {
		return update;
	}

	return { requestId, target, requestedAt, attemptId, previousAttempt, status: "superseded" };
}

export function getAgentUpdateState(agent: Agent, serverTag: string | null, elapsed = performance.now()) {
	const policy = assessCapabilities(agent.capabilities);
	const enrolled = isEnrolledAgent(agent);
	const update = reconcile(agent, policy, serverTag, elapsed);

	return {
		agent,
		policy,
		serverTag,
		elapsed,
		enrolled,
		update,
		active: isActive(update) ? update : null,
		canQueue: enrolled && policy.remote && canTarget(policy, serverTag),
	};
}

type State = ReturnType<typeof getAgentUpdateState>;

type MaintenanceEvent = {
	type: "maintenance";
	request: AgentMaintenanceRequest;
	now: number;
	nextRequestId: () => string;
	hasActiveBackup: () => boolean;
};

type UpdateEvent =
	| { type: "ready"; capabilities: AgentCapabilities }
	| { type: "queue"; requestId: string; target: AgentReleaseManifest; now: number }
	| MaintenanceEvent;

export function transitionAgentUpdate(state: State, event: UpdateEvent): AgentUpdate | null {
	switch (event.type) {
		case "ready": {
			const policy = assessCapabilities(event.capabilities);
			const { update } = state;
			if (
				update?.status === "queued" &&
				!update.attemptId &&
				update.previousAttempt?.reason !== "expired" &&
				!event.capabilities.updateTrial &&
				matchesBuild(update.target, policy)
			) {
				return { ...update, status: "completed" };
			}

			const readyAgent = { ...state.agent, status: "online" as const, capabilities: event.capabilities };

			return reconcile(readyAgent, policy, state.serverTag, state.elapsed);
		}
		case "queue": {
			if (state.active) return state.active;

			const previous = state.update?.attemptId ? state.update : state.update?.previousAttempt;

			return {
				requestId: event.requestId,
				target: event.target,
				requestedAt: event.now,
				status: "queued",
				...(previous?.attemptId && {
					previousAttempt: {
						requestId: previous.requestId,
						attemptId: previous.attemptId,
						reason: "replaced",
					},
				}),
			};
		}
		case "maintenance":
			return maintain(state, event);
	}
}

type RollbackRequest = Extract<AgentMaintenanceRequest, { action: "fail" }>;

function recordRollback(update: AgentUpdate | null, request: RollbackRequest): AgentUpdate | null {
	if (!update) return update;

	const { requestId, target, requestedAt, previousAttempt } = update;
	if (matchesAttempt(previousAttempt, request)) {
		if (update.status === "queued" && previousAttempt?.reason === "expired") {
			return { requestId, target, requestedAt, previousAttempt, status: "failed" };
		}
		return update;
	}
	if (requestId !== request.requestId) {
		if (previousAttempt?.requestId === request.requestId) {
			throw new ConflictError("Agent update cannot be failed by this attempt");
		}
		return update;
	}
	if (update.status === "accepted" && matchesAttempt(update, request)) {
		throw new GoneError("Agent update has already been accepted");
	}

	const restoredRequest =
		update.status === "queued" &&
		!update.attemptId &&
		previousAttempt?.reason !== "expired" &&
		previousAttempt?.attemptId !== request.attemptId;
	if (!restoredRequest && !matchesAttempt(update, request)) {
		throw new ConflictError("Agent update cannot be failed by this attempt");
	}
	if (update.status === "failed") return update;

	return { requestId, target, requestedAt, previousAttempt, attemptId: request.attemptId, status: "failed" };
}

function confirmTrial(
	{ agent, update, policy, elapsed }: State,
	request: Extract<AgentMaintenanceRequest, { action: "confirm" | "accept" }>,
) {
	if (request.action === "accept") {
		const recorded = agent.updateRequest;
		if (!recorded || !matchesAttempt(recorded, request) || (!isTrial(recorded) && recorded.status !== "accepted")) {
			throw new GoneError("The controller has no matching acceptance to replay");
		}
	}
	if (!update || !matchesAttempt(update, request)) {
		throw new ConflictError("Agent update attempt changed");
	}

	if (!hasLiveTrial(agent, update, policy)) {
		throw new ConflictError("Agent update is awaiting exact controller readiness");
	}

	if (request.action === "confirm") {
		if (!hasLease(update, elapsed)) throw new ConflictError("Agent update has no active lease");

		return update.status === "started" ? { ...update, status: "confirming" as const } : update;
	}

	if (update.status === "accepted") return update;
	if (
		update.status !== "confirming" &&
		(update.status !== "started" || !agent.capabilities.updateTrial?.locallyAccepted)
	) {
		throw new ConflictError("Agent update has not been confirmed");
	}
	const { requestId, attemptId, target, requestedAt, previousAttempt } = update;

	return { requestId, attemptId, target, requestedAt, previousAttempt, status: "accepted" as const };
}

function checkExpiredPreparation(update: AgentUpdate, attemptId: string) {
	const previous = update.previousAttempt;
	if (update.status === "queued" && previous?.reason === "expired" && previous.attemptId === attemptId) {
		throw new GoneError("Agent update attempt has expired");
	}
}

function maintain(
	state: State,
	{ request, now, nextRequestId, hasActiveBackup }: MaintenanceEvent,
): AgentUpdate | null {
	const { agent, update, elapsed, policy } = state;

	switch (request.action) {
		case "failPreparation": {
			if (update?.requestId !== request.requestId) throw new ConflictError("Agent update request changed");
			if (update.status === "failed" && matchesAttempt(update, request)) return update;

			checkExpiredPreparation(update, request.attemptId);
			if (
				update.status !== "queued" ||
				update.attemptId ||
				update.previousAttempt?.attemptId === request.attemptId
			) {
				throw new ConflictError("Agent update preparation cannot be failed by this attempt");
			}

			return { ...update, status: "failed", attemptId: request.attemptId };
		}
		case "fail":
			return recordRollback(agent.updateRequest, request);
		case "confirm":
		case "accept":
			return confirmTrial(state, request);
		case "start": {
			if (update?.requestId !== request.requestId) throw new ConflictError("Agent update request changed");
			checkExpiredPreparation(update, request.attemptId);
			if (hasActiveBackup()) throw new ConflictError("Agent backup has not finished");

			if (update.status === "queued" && request.attemptId !== update.previousAttempt?.attemptId) {
				const { requestId, target, requestedAt, previousAttempt } = update;

				return {
					requestId,
					target,
					requestedAt,
					attemptId: request.attemptId,
					status: "started",
					startedAt: now,
					previousAttempt,
					lease: { processId: leaseProcessId, deadline: elapsed + UPDATE_ATTEMPT_TIMEOUT_MS },
				};
			}
			if (update.status === "started" && hasLease(update, elapsed) && matchesAttempt(update, request))
				return update;

			throw new ConflictError("Agent update cannot be started by this attempt");
		}
		case "poll": {
			if (update?.status !== "started" || hasLease(update, elapsed) || hasLiveTrial(agent, update, policy))
				return update;

			const { requestId, requestedAt, target, attemptId } = update;

			return {
				requestId: nextRequestId(),
				requestedAt,
				target,
				status: "queued",
				previousAttempt: { requestId, attemptId, reason: "expired" },
			};
		}
	}
}

function presentStatus(status: AgentUpdate["status"]) {
	if (status === "confirming") return "started";
	if (status === "accepted") return "completed";
	return status;
}

export function presentAgentUpdate(
	{ enrolled, policy, update, active, serverTag }: State,
	release: AgentReleaseManifest | null,
) {
	const { protocolVersion, required, remote } = policy;
	const request = update && {
		id: update.requestId,
		targetTag: update.target.tag,
		status: presentStatus(update.status),
		requestedAt: update.requestedAt,
	};

	const tag = remote ? (active?.target.tag ?? release?.tag ?? null) : serverTag;
	const targetTag = canTarget(policy, tag) ? tag : null;
	if (!enrolled || (!required && !targetTag)) {
		return { protocolVersion, availability: "none" as const, delivery: null, targetTag: null, request };
	}

	return {
		protocolVersion,
		availability: required ? ("required" as const) : ("available" as const),
		delivery: targetTag && remote ? ("remote" as const) : ("manual" as const),
		targetTag,
		request,
	};
}

export function presentMaintenanceUpdate(update: AgentUpdate | null, action: AgentMaintenanceRequest["action"]) {
	if ((action !== "poll" && action !== "start") || !isActive(update)) return null;

	return {
		requestId: update.requestId,
		status: update.status === "queued" ? ("queued" as const) : ("started" as const),
		target: update.target,
	};
}
