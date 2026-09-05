import { Effect } from "effect";
import { logger } from "@zerobyte/core/node";
import { toMessage } from "@zerobyte/core/utils";
import type {
	BackupRunPayload,
	BackupCancelPayload,
	RestoreRunPayload,
	RestoreCancelPayload,
	VolumeCommand,
	VolumeCommandResponsePayload,
} from "@zerobyte/contracts/agent-protocol";
import { AgentConnections, type AgentManagerEvent } from "./agent-connections";
import { createAgentControllerListener } from "./listener";
import type { AgentConnectionData, ControllerTransport } from "./session";

export type { AgentManagerEvent } from "./agent-connections";

/** Listener lifetime and agent lookup. Each agent owns its connection transitions. */
export function createAgentManagerRuntime(onEvent: (event: AgentManagerEvent) => void | Promise<void>) {
	const agents = new Map<string, AgentConnections>();
	let listener: ReturnType<typeof createAgentControllerListener> | undefined;
	let lifecycle: "running" | "stopping" | "stopped" = "running";
	let lifecycleTail = Promise.resolve();
	const isRunning = () => lifecycle === "running";

	const getAgent = (agentId: string) => {
		const existing = agents.get(agentId);
		if (existing) return existing;
		const agent: AgentConnections = new AgentConnections(onEvent, () => {
			if (agent.isIdle && agents.get(agentId) === agent) agents.delete(agentId);
		});
		agents.set(agentId, agent);
		return agent;
	};

	const beginOpeningConnection = (data: AgentConnectionData, transport: ControllerTransport) => {
		if (isRunning()) return getAgent(data.agentId).begin(data, transport);
		try {
			transport.close(1008, "controller_stopping");
		} catch (error) {
			logger.warn(`Failed to reject agent ${data.agentId}: ${toMessage(error)}`);
		}
		return false;
	};
	const promoteOpeningConnection = (agentId: string, connectionId: string) =>
		agents.get(agentId)?.promote(connectionId) ?? Promise.resolve(false);
	const rejectOpeningConnection = (agentId: string, connectionId: string, reason = "connection_rejected") =>
		Promise.resolve(agents.get(agentId)?.reject(connectionId, reason) ?? false);
	const receive = (agentId: string, connectionId: string, text: string, waitForCompletion: boolean) =>
		agents.get(agentId)?.receive(connectionId, text, waitForCompletion) ?? Promise.resolve(false);
	const closeConnection = (agentId: string, connectionId: string) =>
		agents.get(agentId)?.close(connectionId) ?? Promise.resolve(false);
	const openConnection = (data: AgentConnectionData, transport: ControllerTransport) => {
		if (!beginOpeningConnection(data, transport)) return Promise.resolve(false);
		return promoteOpeningConnection(data.agentId, data.id);
	};
	const reportListenerFailure = async (operation: Promise<unknown>, data: AgentConnectionData) => {
		try {
			await operation;
		} catch (error) {
			logger.error(`Agent connection ${data.id} for ${data.agentId} failed: ${toMessage(error)}`);
		}
	};

	const serializeLifecycle = (transition: () => Promise<void>) => {
		const operation = lifecycleTail.then(transition);
		lifecycleTail = operation.catch(() => undefined);
		return operation;
	};
	const start = Effect.promise(() =>
		serializeLifecycle(async () => {
			if (listener) return;
			lifecycle = "running";
			try {
				listener = createAgentControllerListener({
					isRunning,
					onOpen: (data, transport) => reportListenerFailure(openConnection(data, transport), data),
					onMessage: (data, text) => reportListenerFailure(receive(data.agentId, data.id, text, false), data),
					onClose: (data) => reportListenerFailure(closeConnection(data.agentId, data.id), data),
				});
			} catch (error) {
				lifecycle = "stopped";
				throw error;
			}
		}),
	);
	const stop = Effect.promise(() =>
		serializeLifecycle(async () => {
			if (lifecycle === "stopped") return;
			lifecycle = "stopping";
			let stoppedListener = Promise.resolve();
			try {
				stoppedListener = Promise.resolve(listener?.stop(false));
			} catch (error) {
				logger.error(`Failed to stop agent listener: ${toMessage(error)}`);
			}
			await Promise.all([...agents.values()].map((agent) => agent.stop()));
			await stoppedListener.catch((error) => logger.error(`Failed to stop agent listener: ${toMessage(error)}`));
			agents.clear();
			listener = undefined;
			lifecycle = "stopped";
		}),
	);

	return {
		start,
		stop,
		getControllerUrl: () => (listener ? `ws://127.0.0.1:${listener.port}` : null),
		getAgentCount: () => agents.size,
		getRetirementCount: () => [...agents.values()].reduce((count, agent) => count + agent.retirementCount, 0),
		getLifecycle: () => lifecycle,
		beginOpeningConnection,
		promoteOpeningConnection,
		rejectOpeningConnection,
		openConnection,
		handleConnectionMessage: (agentId: string, connectionId: string, text: string) =>
			receive(agentId, connectionId, text, true).catch(() => false),
		closeConnection,
		disconnectAgent: (agentId: string) => agents.get(agentId)?.disconnect() ?? Promise.resolve(false),
		waitForAgentReady: (agentId: string, timeoutMs = 10_000) => {
			if (!isRunning()) return Promise.resolve(false);
			if (timeoutMs <= 0) return Promise.resolve(agents.get(agentId)?.isReady ?? false);
			return getAgent(agentId).waitForReady(timeoutMs);
		},
		sendBackup: (agentId: string, payload: BackupRunPayload) =>
			agents.get(agentId)?.sendBackup(payload) ?? Effect.succeed(false),
		cancelBackup: (agentId: string, payload: BackupCancelPayload) =>
			agents.get(agentId)?.cancelBackup(payload) ?? Effect.succeed(false),
		sendRestore: (agentId: string, payload: RestoreRunPayload) =>
			agents.get(agentId)?.sendRestore(payload) ?? Effect.succeed(false),
		cancelRestore: (agentId: string, payload: RestoreCancelPayload) =>
			agents.get(agentId)?.cancelRestore(payload) ?? Effect.succeed(false),
		runVolumeCommand: (
			agentId: string,
			organizationId: string,
			command: VolumeCommand,
		): Effect.Effect<VolumeCommandResponsePayload | null, Error> =>
			agents.get(agentId)?.runVolumeCommand(organizationId, command) ?? Effect.succeed(null),
	};
}

export type AgentManagerRuntime = ReturnType<typeof createAgentManagerRuntime>;
