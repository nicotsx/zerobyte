export const CONNECTION_DIAGNOSTIC_INTERVAL_MS = 5_000;

type HeartbeatKind = "ping" | "pong";

type RuntimeSnapshot = {
	inboundQueuedMessages: number;
	outboundQueuedMessages: number;
	transportBufferedBytes: number | null;
};

export const createConnectionDiagnostics = <Runtime extends RuntimeSnapshot>(
	connectionId: string,
	runtime: () => Runtime,
	intervalMs = CONNECTION_DIAGNOSTIC_INTERVAL_MS,
) => {
	const connectedAt = Date.now();
	let lastCheckAt = connectedAt;
	let lastCheckMonotonicAt = performance.now();
	let maxTimerDelayMs = 0;
	let lastClockDriftMs = 0;

	let lastReceivedAt: number | null = null;
	let lastProcessedAt: number | null = null;
	let processing: { type: string; startedAt: number } | null = null;

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

		onProcessing: (type: string) => {
			processing = { type, startedAt: performance.now() };
		},

		onProcessed: () => {
			processing = null;
			lastProcessedAt = Date.now();
		},

		onPingQueued: () => {
			lastPingQueuedAt = Date.now();
		},

		onHeartbeatProcessed: (kind: HeartbeatKind, token: number) => {
			if (kind === "ping") {
				lastPingProcessedAt = Date.now();
				lastPingToken = token;
				pingsProcessed += 1;
			} else {
				lastPongProcessedAt = Date.now();
				lastPongToken = token;
				pongsProcessed += 1;
			}
		},

		onHeartbeatSent: (kind: HeartbeatKind, token: number) => {
			if (kind === "ping") {
				lastPingSentAt = Date.now();
				lastPingToken = token;
				pingsSent += 1;
			} else {
				lastPongSentAt = Date.now();
				lastPongToken = token;
				pongsSent += 1;
			}
		},

		checkTimer: () => {
			const now = Date.now();
			const monotonicNow = performance.now();
			const monotonicElapsed = monotonicNow - lastCheckMonotonicAt;
			const timerDelayMs = Math.max(0, Math.round(monotonicElapsed - intervalMs));

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
				currentTimerDelayMs: Math.max(0, Math.round(monotonicNow - lastCheckMonotonicAt - intervalMs)),
				lastClockDriftMs,
				currentClockDriftMs: Math.round(now - lastCheckAt - (monotonicNow - lastCheckMonotonicAt)),
				rssBytes: process.memoryUsage().rss,
				...runtime(),
			};
		},
	};
};
