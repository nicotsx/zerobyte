import { fromAny } from "@total-typescript/shoehorn";
import { afterEach, expect, test } from "vitest";
import { cleanup, render, screen } from "~/test/test-utils";
import { HttpResponse, http, server } from "~/test/msw/server";
import { useBackupTask, type BackupTask } from "../backup-tasks";

class MockEventSource {
	onerror: ((event: Event) => void) | null = null;

	addEventListener() {}
	close() {}
}

const originalEventSource = globalThis.EventSource;

const BackupTaskStatus = () => {
	const { isBackupRunning } = useBackupTask("backup-1");
	return <div>{isBackupRunning ? "Backup running" : "Backup ready"}</div>;
};

afterEach(() => {
	cleanup();
	globalThis.EventSource = originalEventSource;
});

test("shows a running backup from the suspense-backed initial snapshot", async () => {
	globalThis.EventSource = fromAny(MockEventSource);
	const runningBackupTask: BackupTask = {
		id: "task-backup",
		kind: "backup",
		status: "running",
		resourceType: "backup_schedule",
		resourceId: "backup-1",
		input: { kind: "backup", scheduleId: 1, scheduleShortId: "backup-1", manual: false },
		operationKey: null,
		targetAgentId: null,
		error: null,
		cancellationRequested: false,
		createdAt: 1,
		startedAt: 1,
		updatedAt: 1,
		finishedAt: null,
		progress: null,
		result: null,
	};
	let initialSnapshotUrl: URL | undefined;
	server.use(
		http.get("/api/v1/tasks", ({ request }) => {
			initialSnapshotUrl = new URL(request.url);
			return HttpResponse.json([runningBackupTask]);
		}),
	);

	render(<BackupTaskStatus />, { withSuspense: true });

	expect(await screen.findByText("Backup running")).toBeTruthy();
	expect(initialSnapshotUrl?.search).toBe("");
});
