import { Effect, Queue } from "effect";
import type { parseAgentMessage, AgentMessage } from "@zerobyte/contracts/agent-protocol";

const MAX_QUEUED_MESSAGES = 64;
export const MAX_AGENT_INBOUND_BYTES = 1024 * 1024;

export type InboundAgentMessage = { text: string; parsed: ReturnType<typeof parseAgentMessage> };
type QueueEntry = InboundAgentMessage & { bytes: number; progressKey: string | null };

const progressKey = (message: AgentMessage) => {
	switch (message.type) {
		case "backup.progress":
			return JSON.stringify([message.type, message.payload.jobId, message.payload.scheduleId]);
		case "restore.progress": {
			const { restoreId, organizationId, repositoryId, snapshotId } = message.payload;

			return JSON.stringify([message.type, restoreId, organizationId, repositoryId, snapshotId]);
		}
		default:
			return null;
	}
};

export const createAgentMessageInbox = () => {
	const queue = Effect.runSync(Queue.dropping<QueueEntry>(MAX_QUEUED_MESSAGES));
	const pendingProgress = new Map<string, QueueEntry>();
	let queuedBytes = 0;
	let coalescedProgressMessages = 0;

	return {
		offer: ({ text, parsed }: InboundAgentMessage) => {
			const bytes = Buffer.byteLength(text);

			if (bytes > MAX_AGENT_INBOUND_BYTES) return false;

			const key = parsed?.success ? progressKey(parsed.data) : null;
			const pending = key === null ? undefined : pendingProgress.get(key);

			if (pending) {
				const nextQueuedBytes = queuedBytes - pending.bytes + bytes;

				if (nextQueuedBytes > MAX_AGENT_INBOUND_BYTES) return false;

				Object.assign(pending, { text, parsed, bytes });
				queuedBytes = nextQueuedBytes;
				coalescedProgressMessages += 1;
				return true;
			}

			if (queuedBytes + bytes > MAX_AGENT_INBOUND_BYTES) return false;

			const entry: QueueEntry = { text, parsed, bytes, progressKey: key };

			if (!Queue.offerUnsafe(queue, entry)) return false;

			queuedBytes += bytes;

			if (key === null) {
				// Control and terminal messages must stay between the progress updates that surround them.
				pendingProgress.clear();
			} else {
				pendingProgress.set(key, entry);
			}

			return true;
		},

		take: Queue.take(queue).pipe(
			Effect.map((entry): InboundAgentMessage => {
				queuedBytes -= entry.bytes;

				if (entry.progressKey !== null && pendingProgress.get(entry.progressKey) === entry) {
					pendingProgress.delete(entry.progressKey);
				}

				return { text: entry.text, parsed: entry.parsed };
			}),
		),

		snapshot: () => ({
			inboundQueuedMessages: Queue.sizeUnsafe(queue),
			queuedBytes,
			coalescedProgressMessages,
			inboundMessageLimit: MAX_QUEUED_MESSAGES,
			inboundByteLimit: MAX_AGENT_INBOUND_BYTES,
		}),

		shutdown: Queue.shutdown(queue).pipe(
			Effect.tap(() =>
				Effect.sync(() => {
					pendingProgress.clear();
					queuedBytes = 0;
				}),
			),
		),
	};
};
