import { afterEach, expect, test, vi } from "vitest";
import { createConnectionDiagnostics } from "../connection-diagnostics";

const runtime = () => ({ inboundQueuedMessages: 0, outboundQueuedMessages: 0, transportBufferedBytes: 0 });

afterEach(() => {
	vi.useRealTimers();
});

test("processing duration survives wall-clock changes", async () => {
	vi.useFakeTimers({ toFake: ["Date", "performance"] });
	const diagnostics = createConnectionDiagnostics("connection-1", runtime);

	diagnostics.onReceived();
	diagnostics.onProcessing("backup.failed");

	vi.setSystemTime(Date.now() - 3_600_000);
	await vi.advanceTimersByTimeAsync(100);

	const snapshot = diagnostics.snapshot();

	expect(snapshot.processingMessageType).toBe("backup.failed");
	expect(snapshot.processingMessageMs).toBe(100);
	expect(snapshot.currentClockDriftMs).toBe(-3_600_000);

	diagnostics.onProcessed();

	expect(diagnostics.snapshot().processingMessageType).toBeNull();
	expect(diagnostics.snapshot().processingMessageMs).toBeNull();
});

test("a snapshot reports timer delay even before the monitoring loop resumes", async () => {
	vi.useFakeTimers({ toFake: ["Date", "performance"] });
	const diagnostics = createConnectionDiagnostics("connection-1", runtime);

	await vi.advanceTimersByTimeAsync(65_000);

	expect(diagnostics.snapshot()).toMatchObject({ currentTimerDelayMs: 60_000, currentClockDriftMs: 0 });
	expect(diagnostics.checkTimer()).toEqual({ timerDelayMs: 60_000, clockDriftMs: 0 });
	expect(diagnostics.snapshot()).toMatchObject({ maxTimerDelayMs: 60_000, currentTimerDelayMs: 0 });
});

test("heartbeat observations record tokens and counts without protocol messages", () => {
	const diagnostics = createConnectionDiagnostics("connection-1", runtime);

	diagnostics.onPingQueued();
	diagnostics.onHeartbeatSent("ping", 123);
	diagnostics.onHeartbeatProcessed("ping", 123);
	diagnostics.onHeartbeatSent("pong", 123);
	diagnostics.onHeartbeatProcessed("pong", 123);

	expect(diagnostics.snapshot()).toMatchObject({
		lastPingQueuedAt: expect.any(Number),
		lastPingSentAt: expect.any(Number),
		lastPingProcessedAt: expect.any(Number),
		lastPingToken: 123,
		lastPongSentAt: expect.any(Number),
		lastPongProcessedAt: expect.any(Number),
		lastPongToken: 123,
		pingsSent: 1,
		pingsProcessed: 1,
		pongsSent: 1,
		pongsProcessed: 1,
	});
});

test("timer diagnostics use the caller's sampling interval", async () => {
	vi.useFakeTimers({ toFake: ["Date", "performance"] });
	const diagnostics = createConnectionDiagnostics("connection-1", runtime, 10_000);

	await vi.advanceTimersByTimeAsync(15_000);

	expect(diagnostics.snapshot().currentTimerDelayMs).toBe(5_000);
	expect(diagnostics.checkTimer()).toEqual({ timerDelayMs: 5_000, clockDriftMs: 0 });
});
