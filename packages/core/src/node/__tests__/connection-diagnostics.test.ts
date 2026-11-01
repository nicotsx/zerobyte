import { afterEach, expect, test, vi } from "vitest";
import { createConnectionDiagnostics } from "../connection-diagnostics";

const runtime = () => ({ inboundQueuedMessages: 0, outboundQueuedMessages: 0, transportBufferedBytes: 0 });

afterEach(() => {
	vi.useRealTimers();
});

test("processing duration survives wall-clock changes and snapshots exclude message payloads", async () => {
	vi.useFakeTimers({ toFake: ["Date", "performance"] });
	const diagnostics = createConnectionDiagnostics("connection-1", runtime);

	diagnostics.onReceived();
	diagnostics.onProcessing({
		type: "backup.failed",
		payload: { jobId: "job-1", scheduleId: "schedule-1", error: "private-error-content" },
	});

	vi.setSystemTime(Date.now() - 3_600_000);
	await vi.advanceTimersByTimeAsync(100);

	const snapshot = diagnostics.snapshot();

	expect(snapshot.processingMessageType).toBe("backup.failed");
	expect(snapshot.processingMessageMs).toBe(100);
	expect(snapshot.currentClockDriftMs).toBe(-3_600_000);
	expect(JSON.stringify(snapshot)).not.toContain("private-error-content");
	expect(JSON.stringify(snapshot)).not.toContain("job-1");

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
