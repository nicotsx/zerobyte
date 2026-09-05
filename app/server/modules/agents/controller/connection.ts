import { Cause, Deferred, Effect, Exit, Fiber, Queue, Scope } from "effect";
import { logger } from "@zerobyte/core/node";
import { toMessage } from "@zerobyte/core/utils";
import type { AgentCapabilities, VolumeCommand } from "@zerobyte/contracts/agent-protocol";
import { agentsService } from "../agents.service";
import {
	createControllerAgentSession,
	type AgentConnectionData,
	type ControllerAgentSession,
	type ControllerAgentSessionEvent,
	type ControllerTransport,
} from "./session";

type Phase = "opening" | "initializing" | "active" | "draining" | "closed";
type Message = { text: string; bytes: number; completion: Deferred.Deferred<void, Error> };
type ConnectionEvents = {
	isCurrent: () => boolean;
	onEvent: (event: ControllerAgentSessionEvent) => Promise<void>;
	onTerminal: (reason: string, code?: number, closeTransport?: boolean) => void;
	onReady: () => void;
};

/** One socket lifetime: its protocol, bounded inbox, status writes and cleanup. */
export class AgentConnection {
	private phase: Phase = "opening";
	// Status writes are uninterruptible within this scope: closing waits for them before writing offline.
	private readonly scope = Effect.runSync(Scope.make());
	private readonly inbox = Effect.runSync(Queue.dropping<Message>(64));
	private readonly pending = new Set<Deferred.Deferred<void, Error>>();
	private queuedBytes = 0;
	private capabilities: AgentCapabilities | null = null;
	private readonly protocol: ControllerAgentSession;
	private closing: Promise<void> | undefined;

	constructor(
		readonly data: AgentConnectionData,
		private readonly transport: ControllerTransport,
		private readonly events: ConnectionEvents,
	) {
		this.protocol = Effect.runSync(
			Scope.extend(
				createControllerAgentSession(data, transport, (event) => this.handleEvent(event)),
				this.scope,
			),
		);
		Effect.runSync(Scope.addFinalizer(this.scope, this.discardInbox()));
	}

	get isClosed() {
		return this.phase === "closed";
	}
	get isInitializing() {
		return this.phase === "initializing";
	}
	get isReady() {
		return this.phase === "active" && this.events.isCurrent() && Effect.runSync(this.protocol.isReady());
	}

	claim() {
		if (this.phase !== "opening") return false;

		this.phase = "initializing";
		return true;
	}

	async start() {
		const registration = {
			agentId: this.data.agentId,
			agentName: this.data.agentName,
			agentKind: this.data.agentKind,
			organizationId: this.data.organizationId,
			credentialVersion: this.data.credentialVersion,
		};

		const initialize = Effect.gen(this, function* () {
			yield* Effect.promise(async () => {
				if (this.events.isCurrent()) await agentsService.markAgentConnecting(registration);
			}).pipe(Effect.uninterruptible);

			if (this.isClosed) return;

			const initialMessages = [...this.pending];

			yield* Effect.forkIn(this.processInbox(), this.scope);
			yield* Effect.forkIn(Scope.extend(this.protocol.run, this.scope), this.scope);

			for (const completion of initialMessages) yield* Deferred.await(completion);

			if (this.isClosed) return;

			this.phase = "active";
			this.events.onReady();
		});

		const fiber = Effect.runSync(Effect.forkIn(initialize, this.scope));
		const result = await Effect.runPromise(Fiber.await(fiber));

		if (Exit.isFailure(result) && !Cause.isInterruptedOnly(result.cause)) {
			await Effect.runPromise(Effect.failCause(result.cause));
		}
	}

	async receive(text: string, waitForCompletion: boolean) {
		if (this.phase === "closed" || this.phase === "draining") return false;

		const bytes = Buffer.byteLength(text);
		const nextBytes = this.queuedBytes + bytes;

		if (nextBytes > 1024 * 1024) return this.rejectOverflow();

		const completion = Effect.runSync(Deferred.make<void, Error>());
		const message = { text, bytes, completion };

		this.queuedBytes = nextBytes;
		this.pending.add(completion);

		if (!Effect.runSync(Queue.offer(this.inbox, message))) {
			this.queuedBytes -= bytes;
			this.pending.delete(completion);
			return this.rejectOverflow();
		}

		if (waitForCompletion && this.phase === "active") await Effect.runPromise(Deferred.await(completion));
		return true;
	}

	private rejectOverflow() {
		const reason = this.phase === "opening" ? "pending_message_limit" : "active_message_limit";

		this.events.onTerminal(reason, 1009);
		return false;
	}

	async drain() {
		if (this.phase !== "active") return false;

		this.phase = "draining";
		await Effect.runPromise(Effect.forEach([...this.pending], Deferred.await, { discard: true }));
		return true;
	}

	resume() {
		if (this.phase !== "draining") return;

		this.phase = "active";
		this.events.onReady();
	}

	close(reason: string, code = 1000, closeTransport = true) {
		if (this.closing) return this.closing;

		this.phase = "closed";

		if (closeTransport) {
			try {
				this.transport.close(code, reason);
			} catch (error) {
				logger.warn(`Failed to close agent ${this.data.agentId}: ${toMessage(error)}`);
			}
		}

		this.closing = Effect.runPromise(Scope.close(this.scope, Exit.void)).catch((error) => {
			logger.error(`Failed to release agent ${this.data.agentId}: ${toMessage(error)}`);
		});
		return this.closing;
	}

	allows(capability: "backup" | "restore" | "volume", organizationId?: string) {
		if (!this.isReady) return false;

		if (
			organizationId !== undefined &&
			this.data.agentKind !== "local" &&
			this.data.organizationId !== organizationId
		)
			return false;

		if (capability === "restore" && this.data.agentKind !== "local") return false;
		return this.capabilities?.[capability] === true;
	}

	allowsVolume(command: VolumeCommand, organizationId: string) {
		if (!this.isReady) return false;
		if (this.data.agentKind !== "local" && this.data.organizationId !== organizationId) return false;

		let rootId: string | undefined;

		if (command.name === "filesystem.browse") rootId = command.reference?.rootId;
		if (
			(command.name === "volume.statfs" || command.name === "volume.listFiles") &&
			command.source.kind === "agent-filesystem"
		) {
			rootId = command.source.reference.rootId;
		}

		if (rootId !== undefined)
			return this.capabilities?.trustedRoots?.some((root) => root.id === rootId && root.canBackup) === true;
		return this.data.agentKind === "local" && this.capabilities?.volume === true;
	}

	// Admission belongs to the agent owner; protocol operations stay scoped to this socket.
	send<A, E>(operation: (session: ControllerAgentSession) => Effect.Effect<A, E>) {
		return Effect.runPromise(operation(this.protocol));
	}

	private handleEvent(event: ControllerAgentSessionEvent): Effect.Effect<void> {
		if (event.type === "session.terminal") {
			return Effect.sync(() => this.events.onTerminal(event.payload.reason, event.payload.code, false));
		}
		return Effect.suspend(() => {
			if (!this.events.isCurrent()) return Effect.void;

			if (event.type === "agent.ready") {
				this.capabilities = event.payload.capabilities;

				const capabilities = {
					...event.payload.capabilities,
					protocolVersion: event.payload.protocolVersion,
					protocolCompatible: true,
					hostname: event.payload.hostname,
					platform: event.payload.platform,
				};

				return Effect.promise(async () => {
					await agentsService.markAgentOnline(
						this.data.agentId,
						Date.now(),
						capabilities,
						this.data.credentialVersion,
					);
					this.events.onReady();
				}).pipe(Effect.uninterruptible);
			}

			if (event.type === "heartbeat.pong") {
				return Effect.promise(() =>
					agentsService.markAgentSeen(this.data.agentId, Date.now(), this.data.credentialVersion),
				).pipe(Effect.asVoid, Effect.uninterruptible);
			}

			if (event.type === "volume.commandResult") return this.protocol.handleVolumeCommandResult(event.payload);
			return Effect.promise(() => this.events.onEvent(event));
		});
	}

	private processInbox() {
		return Effect.forever(
			Effect.gen(this, function* () {
				const message = yield* Queue.take(this.inbox);
				this.queuedBytes -= message.bytes;
				const result = yield* Effect.exit(this.protocol.handleMessage(message.text));
				this.pending.delete(message.completion);
				if (Exit.isSuccess(result)) {
					yield* Deferred.succeed(message.completion, undefined);
				} else {
					const error = new Error(`Inbound message processing failed: ${toMessage(result.cause)}`);
					yield* Deferred.fail(message.completion, error);
					this.events.onTerminal("inbound_processing_failed", 1011);
				}
			}),
		);
	}

	private discardInbox() {
		return Effect.gen(this, function* () {
			const error = new Error("Agent session closed before an admitted message completed");
			for (const completion of this.pending) yield* Deferred.fail(completion, error);
			this.pending.clear();
			this.queuedBytes = 0;
			yield* Queue.shutdown(this.inbox);
		});
	}
}
