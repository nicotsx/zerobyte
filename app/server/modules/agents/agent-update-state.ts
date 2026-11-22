import type { AgentMaintenanceRequest } from "@zerobyte/contracts/agent-maintenance";
import type { AgentReleaseManifest } from "@zerobyte/contracts/agent-release";
import { SUPPORTED_AGENT_PROTOCOL_MIN_VERSION } from "@zerobyte/contracts/agent-protocol";
import { ConflictError } from "http-errors-enhanced";
import { gt } from "semver";
import type { AgentUpdate, AttemptLease } from "~/server/db/agent-update";
import type { Agent, AgentCapabilities } from "~/server/db/schema";
import { getAgentVersion, isSupportedAgentProtocol } from "./agent-update-release";

const UPDATE_ATTEMPT_TIMEOUT_MS = 30 * 60 * 1000;
const leaseProcessId = Bun.randomUUIDv7();

export const isEnrolledAgent = (agent: Agent) =>
	agent.kind === "remote" && agent.revokedAt === null && agent.enrollmentExpiresAt === null && !!agent.credentialHash;

function assessCapabilities(capabilities: AgentCapabilities, serverTag: string | null) {
	const protocolVersion = capabilities.protocolVersion ?? null;
	const version = getAgentVersion(capabilities.agentVersion);
	const required = protocolVersion !== null && protocolVersion < SUPPORTED_AGENT_PROTOCOL_MIN_VERSION;
	const targetTag =
		protocolVersion !== null &&
		(required || isSupportedAgentProtocol(protocolVersion)) &&
		version !== null &&
		serverTag !== null &&
		gt(serverTag, version)
			? serverTag
			: null;
	const remote =
		capabilities.platform === "linux" &&
		capabilities.selfUpdate === "systemd" &&
		capabilities.connectionSecurity === "secure";

	return { protocolVersion, version, required, targetTag, remote };
}

const isActive = (update: AgentUpdate | null) => update?.status === "queued" || update?.status === "started";

function reconcile(update: AgentUpdate | null, policy: ReturnType<typeof assessCapabilities>): AgentUpdate | null {
	if (!isActive(update)) return update;

	const { requestId, target, requestedAt } = update;
	if (policy.remote && target.tag === policy.targetTag && isSupportedAgentProtocol(target.protocolVersion)) {
		return update;
	}

	return { requestId, target, requestedAt, status: "superseded" };
}

export function getAgentUpdateState(agent: Agent, serverTag: string | null) {
	const policy = assessCapabilities(agent.capabilities, serverTag);
	const enrolled = isEnrolledAgent(agent);
	const update = reconcile(agent.updateRequest, policy);
	const active = isActive(update) ? update : null;

	return {
		policy,
		serverTag,
		enrolled,
		update,
		active,
		canQueue: enrolled && policy.remote && policy.targetTag !== null,
	};
}

type State = ReturnType<typeof getAgentUpdateState>;

type UpdateEvent =
	| { type: "ready"; capabilities: AgentCapabilities }
	| { type: "queue"; requestId: string; target: AgentReleaseManifest; now: number }
	| {
			type: "maintenance";
			request: AgentMaintenanceRequest;
			now: number;
			elapsed: number;
			nextRequestId: () => string;
	  };

export function transitionAgentUpdate(state: State, event: UpdateEvent): AgentUpdate | null {
	switch (event.type) {
		case "ready": {
			const policy = assessCapabilities(event.capabilities, state.serverTag);
			const { update } = state;
			if (
				update &&
				(state.active || update.status === "failed") &&
				policy.version !== null &&
				`v${policy.version}` === update.target.tag &&
				policy.protocolVersion === update.target.protocolVersion
			) {
				const { requestId, target, requestedAt } = update;

				return { requestId, target, requestedAt, status: "completed" };
			}

			return reconcile(update, policy);
		}
		case "queue":
			return (
				state.active ?? {
					requestId: event.requestId,
					target: event.target,
					requestedAt: event.now,
					status: "queued",
				}
			);
		case "maintenance":
			return maintain(state.update, event);
	}
}

function hasAttemptLease(lease: AttemptLease | undefined, elapsed: number) {
	// Give attempts from a previous process one lease window from server startup to recover.
	const deadline = lease?.processId === leaseProcessId ? lease.deadline : UPDATE_ATTEMPT_TIMEOUT_MS;

	return elapsed < deadline;
}

function maintain(
	update: AgentUpdate | null,
	{ request, now, elapsed, nextRequestId }: Extract<UpdateEvent, { type: "maintenance" }>,
): AgentUpdate | null {
	if (update?.status === "started" && !hasAttemptLease(update.lease, elapsed)) {
		if (request.action !== "poll") throw new ConflictError("Agent update attempt expired");

		return { requestId: nextRequestId(), requestedAt: now, target: update.target, status: "queued" };
	}

	if (request.action === "poll") return update;
	if (update?.requestId !== request.requestId) throw new ConflictError("Agent update request changed");

	const { requestId, target, requestedAt } = update;
	const { attemptId } = request;
	if (request.action === "start") {
		if (update.status === "queued") {
			return {
				requestId,
				target,
				requestedAt,
				attemptId,
				status: "started",
				startedAt: now,
				lease: { processId: leaseProcessId, deadline: elapsed + UPDATE_ATTEMPT_TIMEOUT_MS },
			};
		}
		if (update.status === "started" && update.attemptId === attemptId) return update;

		throw new ConflictError("Agent update cannot be started by this attempt");
	}

	if (update.status === "failed" && update.attemptId === attemptId) return update;
	if (update.status === "started" && update.attemptId === attemptId) {
		return { requestId, target, requestedAt, attemptId, status: "failed" };
	}

	throw new ConflictError("Agent update cannot be failed by this attempt");
}

export function presentAgentUpdate({ enrolled, policy, update, active }: State, release: AgentReleaseManifest | null) {
	const { protocolVersion, required, remote, targetTag } = policy;
	const request = update && {
		id: update.requestId,
		targetTag: update.target.tag,
		status: update.status,
		requestedAt: update.requestedAt,
	};

	const offer = remote && targetTag !== (active?.target.tag ?? release?.tag) ? null : targetTag;
	if (!enrolled || (!required && !offer)) {
		return { protocolVersion, availability: "none" as const, delivery: null, targetTag: null, request };
	}

	return {
		protocolVersion,
		availability: required ? ("required" as const) : ("available" as const),
		delivery: offer && remote ? ("remote" as const) : ("manual" as const),
		targetTag: offer,
		request,
	};
}

export const presentMaintenanceUpdate = (update: AgentUpdate | null) =>
	isActive(update) ? { requestId: update.requestId, status: update.status, target: update.target } : null;
