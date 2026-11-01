import type { AgentMessage, ControllerMessage } from "@zerobyte/contracts/agent-protocol";

export const CONNECTION_DIAGNOSTIC_INTERVAL_MS = 5_000;

type Message = AgentMessage | ControllerMessage;

type RuntimeSnapshot = {
	inboundQueuedMessages: number;
	outboundQueuedMessages: number;
	transportBufferedBytes: number | null;
};

export const createConnectionDiagnostics = <Runtime extends RuntimeSnapshot>(
	connectionId: string,
	runtime: () => Runtime,
) => {
	const connectedAt = Date.now();
	let lastCheckAt = connectedAt;
	let lastCheckMonotonicAt = performance.now();
	let maxTimerDelayMs = 0;
	let lastClockDriftMs = 0;

	let lastReceivedAt: number | null = null;
	let lastProcessedAt: number | null = null;
	let processing: { type: Message["type"]; startedAt: number } | null = null;

	let lastPingQueuedAt: number | null = null;
	let lastPingSentAt: number | null = null;
	let lastPingProcessedAt: number | null = null;
	let lastPingToken: number | null = null;
	let lastPongSentAt: number | null = null;
	let lastPongProcessedAt: number | null = null;
	let lastPongToken: number | null = null;
	let pingsSent = 0;
	let pingsProcessed = 0;
	let pongsSent = 0;
	let pongsProcessed = 0;

	return {
		onReceived: () => {
			lastReceivedAt = Date.now();
		},

		onProcessing: (message: Message) => {
			processing = { type: message.type, startedAt: performance.now() };

			if (message.type === "heartbeat.ping") {
				lastPingProcessedAt = Date.now();
				lastPingToken = message.payload.sentAt;
				pingsProcessed += 1;
			} else if (message.type === "heartbeat.pong") {
				lastPongProcessedAt = Date.now();
				lastPongToken = message.payload.sentAt;
				pongsProcessed += 1;
			}
		},

		onProcessed: () => {
			processing = null;
			lastProcessedAt = Date.now();
		},

		onQueued: (message: Message) => {
			if (message.type === "heartbeat.ping") lastPingQueuedAt = Date.now();
		},

		onSent: (message: Message) => {
			if (message.type === "heartbeat.ping") {
				lastPingSentAt = Date.now();
				lastPingToken = message.payload.sentAt;
				pingsSent += 1;
			} else if (message.type === "heartbeat.pong") {
				lastPongSentAt = Date.now();
				lastPongToken = message.payload.sentAt;
				pongsSent += 1;
			}
		},

		checkTimer: () => {
			const now = Date.now();
			const monotonicNow = performance.now();
			const monotonicElapsed = monotonicNow - lastCheckMonotonicAt;
			const timerDelayMs = Math.max(0, Math.round(monotonicElapsed - CONNECTION_DIAGNOSTIC_INTERVAL_MS));

			maxTimerDelayMs = Math.max(maxTimerDelayMs, timerDelayMs);
			lastClockDriftMs = Math.round(now - lastCheckAt - monotonicElapsed);
			lastCheckAt = now;
			lastCheckMonotonicAt = monotonicNow;

			return { timerDelayMs, clockDriftMs: lastClockDriftMs };
		},

		snapshot: () => {
			const now = Date.now();
			const monotonicNow = performance.now();

			return {
				connectionId,
				pid: process.pid,
				timestamp: now,
				connectedAt,
				lastReceivedAt,
				lastProcessedAt,
				processingMessageType: processing?.type ?? null,
				processingMessageMs: processing ? Math.round(monotonicNow - processing.startedAt) : null,
				lastPingQueuedAt,
				lastPingSentAt,
				lastPingProcessedAt,
				lastPingToken,
				lastPongSentAt,
				lastPongProcessedAt,
				lastPongToken,
				pingsSent,
				pingsProcessed,
				pongsSent,
				pongsProcessed,
				maxTimerDelayMs,
				currentTimerDelayMs: Math.max(
					0,
					Math.round(monotonicNow - lastCheckMonotonicAt - CONNECTION_DIAGNOSTIC_INTERVAL_MS),
				),
				lastClockDriftMs,
				currentClockDriftMs: Math.round(now - lastCheckAt - (monotonicNow - lastCheckMonotonicAt)),
				rssBytes: process.memoryUsage().rss,
				...runtime(),
			};
		},
	};
};
