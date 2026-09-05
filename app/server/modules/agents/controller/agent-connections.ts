import { Effect } from "effect";
import { logger } from "@zerobyte/core/node";
import { toMessage } from "@zerobyte/core/utils";
import type {
	AgentMessage,
	AgentProtocolRejection,
	BackupRunPayload,
	BackupCancelPayload,
	RestoreRunPayload,
	RestoreCancelPayload,
	VolumeCommand,
	VolumeCommandResponsePayload,
} from "@zerobyte/contracts/agent-protocol";
import { agentsService } from "../agents.service";
import { AgentConnection } from "./connection";
import type { AgentConnectionData, ControllerTransport } from "./session";

type AgentEventContext = { agentId: string; agentName: string };
export type AgentManagerEvent =
	| (AgentEventContext & { type: "agent.disconnected" })
	| (AgentEventContext & { type: "agent.protocolRejected"; payload: AgentProtocolRejection })
	| (AgentEventContext & AgentMessage);

/** Owns authority for one agent. Only promotion and outbound admission share the serial queue. */
export class AgentConnections {
	private current: AgentConnection | undefined;
	private opening: AgentConnection | undefined;
	private readonly retirements = new Map<AgentConnection, Promise<void>>();
	private tail = Promise.resolve();
	private queued = 0;
	private stopped = false;
	private readonly readyWaiters = new Set<(ready: boolean) => void>();

	constructor(
		private readonly onEvent: (event: AgentManagerEvent) => void | Promise<void>,
		private readonly onIdle: () => void,
	) {}

	get isIdle() {
		return !this.current && !this.opening && !this.retirements.size && !this.queued && !this.readyWaiters.size;
	}
	get retirementCount() {
		return this.retirements.size;
	}
	get isReady() {
		return this.current?.isReady ?? false;
	}

	begin(data: AgentConnectionData, transport: ControllerTransport) {
		if (this.stopped) return false;
		if (this.opening) this.reject(this.opening.data.id, "connection_replaced");

		const connection: AgentConnection = new AgentConnection(data, transport, {
			isCurrent: () => !this.stopped && this.current === connection,
			onEvent: async (event) => {
				if (event.type === "session.terminal") return;
				await this.onEvent({ ...event, agentId: data.agentId, agentName: data.agentName });
			},
			onTerminal: (reason, code, closeTransport) => {
				void this.retire(connection, reason, code, closeTransport);
			},
			onReady: () => this.notifyReady(),
		});

		this.opening = connection;
		return true;
	}

	promote(connectionId: string) {
		const candidate = this.opening;

		if (!candidate || candidate.data.id !== connectionId) return Promise.resolve(false);

		if (this.current?.isInitializing) {
			this.reject(connectionId, "connection_replaced");
			return Promise.resolve(false);
		}

		return this.serialize(async () => {
			while (this.retirements.size) await Promise.all(this.retirements.values());
			if (this.stopped || this.opening !== candidate) return false;

			const previous = this.current;

			try {
				if (previous) {
					if (!(await previous.drain())) {
						this.reject(connectionId, "connection_replaced");
						return false;
					}
					if (this.stopped || this.opening !== candidate) {
						previous.resume();
						return false;
					}
					await this.retire(previous, "connection_replaced");
				}

				if (this.stopped || this.opening !== candidate || !candidate.claim()) return false;

				this.opening = undefined;
				this.current = candidate;

				await candidate.start();
				return !this.stopped && this.current === candidate;
			} catch (error) {
				previous?.resume();
				await this.retire(candidate, "promotion_failed", 1011);
				throw error;
			}
		});
	}

	reject(connectionId: string, reason: string, closeTransport = true) {
		const connection = this.opening;
		if (!connection || connection.data.id !== connectionId) return false;

		const code = reason === "credential_changed" || reason === "controller_stopping" ? 1008 : 1000;

		void this.retire(connection, reason, code, closeTransport);
		return true;
	}

	receive(connectionId: string, text: string, waitForCompletion: boolean) {
		if (this.stopped) return Promise.resolve(false);

		const connection = [this.current, this.opening].find((candidate) => candidate?.data.id === connectionId);
		return connection?.receive(text, waitForCompletion) ?? Promise.resolve(false);
	}

	async close(connectionId: string) {
		const connections = [this.current, this.opening, ...this.retirements.keys()];
		const connection = connections.find((candidate) => candidate?.data.id === connectionId);

		if (!connection) return false;

		await this.retire(connection, "connection_closed", 1000, false);
		return true;
	}

	async disconnect(reason = "disconnected_by_controller") {
		const existed = !this.isIdle;
		const connections = new Set(
			[this.current, this.opening, ...this.retirements.keys()].filter((connection) => connection !== undefined),
		);

		await Promise.all([...connections].map((connection) => this.retire(connection, reason)));
		await this.tail;
		await Promise.all(this.retirements.values());
		return existed;
	}

	async stop() {
		this.stopped = true;
		for (const resolve of this.readyWaiters) resolve(false);
		await this.disconnect("controller_shutdown");
	}

	waitForReady(timeoutMs: number) {
		if (this.stopped || this.isReady || timeoutMs <= 0) return Promise.resolve(this.isReady);

		return new Promise<boolean>((resolve) => {
			const finish = (ready: boolean) => {
				clearTimeout(timer);
				this.readyWaiters.delete(finish);
				resolve(ready);
				this.onIdle();
			};

			const timer = setTimeout(() => finish(this.isReady), timeoutMs);
			this.readyWaiters.add(finish);
		});
	}

	sendBackup(payload: BackupRunPayload) {
		return this.admit(
			(connection) => connection.allows("backup", payload.organizationId),
			(connection) => connection.send((session) => session.sendBackup(payload)),
			false,
		);
	}

	cancelBackup(payload: BackupCancelPayload) {
		return this.admit(
			(connection) => connection.allows("backup"),
			(connection) => connection.send((session) => session.sendBackupCancel(payload)),
			false,
		);
	}

	sendRestore(payload: RestoreRunPayload) {
		return this.admit(
			(connection) => connection.allows("restore", payload.organizationId),
			(connection) => connection.send((session) => session.sendRestore(payload)),
			false,
		);
	}

	cancelRestore(payload: RestoreCancelPayload) {
		return this.admit(
			(connection) => connection.allows("restore"),
			(connection) => connection.send((session) => session.sendRestoreCancel(payload)),
			false,
		);
	}
	runVolumeCommand(
		organizationId: string,
		command: VolumeCommand,
	): Effect.Effect<VolumeCommandResponsePayload | null, Error> {
		const admit = this.admit(
			(connection) => connection.allowsVolume(command, organizationId),
			(connection) => connection.send((session) => session.startVolumeCommand(command)),
			null,
		);

		return admit.pipe(Effect.flatMap((completion) => completion ?? Effect.succeed(null)));
	}

	private admit<A>(
		allowed: (connection: AgentConnection) => boolean,
		send: (connection: AgentConnection) => Promise<A>,
		rejected: A,
	) {
		return Effect.tryPromise({
			try: () => {
				const connection = this.current;

				if (!connection || !allowed(connection)) return Promise.resolve(rejected);

				return this.serialize(() => {
					if (this.current !== connection || !allowed(connection)) return Promise.resolve(rejected);
					return send(connection);
				});
			},
			catch: (error) => new Error(toMessage(error)),
		});
	}

	private serialize<A>(operation: () => Promise<A>) {
		this.queued += 1;

		const result = this.tail.then(operation);

		this.tail = result
			.then(
				() => undefined,
				() => undefined,
			)
			.finally(() => {
				this.queued -= 1;
				this.onIdle();
			});

		return result;
	}

	private retire(connection: AgentConnection, reason: string, code?: number, closeTransport = true) {
		const existing = this.retirements.get(connection);

		if (existing) return existing;
		if (connection.isClosed) return Promise.resolve();

		const wasCurrent = this.current === connection;

		if (wasCurrent) this.current = undefined;
		if (this.opening === connection) this.opening = undefined;

		const retirement = Promise.resolve()
			.then(async () => {
				await connection.close(reason, code, closeTransport);
				if (!wasCurrent) return;
				const data = connection.data;
				await agentsService
					.markAgentOffline(data.agentId, Date.now(), data.credentialVersion)
					.catch((error) => {
						logger.error(`Failed to mark agent ${data.agentId} offline: ${toMessage(error)}`);
					});
				await this.onEvent({ type: "agent.disconnected", agentId: data.agentId, agentName: data.agentName });
			})
			.catch((error) => {
				logger.error(`Failed to retire agent ${connection.data.agentId}: ${toMessage(error)}`);
			})
			.finally(() => {
				this.retirements.delete(connection);
				this.onIdle();
			});

		this.retirements.set(connection, retirement);
		return retirement;
	}

	private notifyReady() {
		if (this.isReady) for (const resolve of this.readyWaiters) resolve(true);
	}
}
