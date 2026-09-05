import { afterEach, describe, expect, test, vi } from "vitest";
import { fromAny } from "@total-typescript/shoehorn";
import { HttpResponse, http, server } from "~/test/msw/server";
import { cleanup, render, screen } from "~/test/test-utils";
import type { BackupSchedule } from "~/client/lib/types";
import { ScheduleSummary } from "../schedule-summary";
import { BackupCard } from "../backup-card";

class MockEventSource {
	onerror: ((event: Event) => void) | null = null;

	addEventListener() {}
	close() {}
}

const originalEventSource = globalThis.EventSource;

vi.mock("@tanstack/react-router", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@tanstack/react-router")>();
	return {
		...actual,
		Link: ({ children }: { children: React.ReactNode }) => <a href="/">{children}</a>,
		useNavigate: () => vi.fn(),
	};
});

const createSchedule = (sourceKind: "managed" | "agent-filesystem", availability = "available", status = "mounted") => {
	const volume =
		sourceKind === "managed"
			? { name: "Documents", shortId: "volume-1", sourceKind, agentId: "local", sourceLocation: null }
			: {
					name: "Family photos",
					shortId: "volume-1",
					sourceKind,
					agentId: "agent-1",
					status,
					sourceLocation: {
						availability,
						machine: { name: "Studio NAS" },
					},
				};

	return fromAny({
		shortId: "backup-1",
		name: "Photos backup",
		volume,
		repositoryId: "repository-1",
		repository: { shortId: "repository-1", name: "Cloud archive", type: "s3" },
		enabled: false,
		cronExpression: "",
		retentionPolicy: null,
		lastBackupStatus: null,
		lastBackupAt: null,
		nextBackupAt: null,
	}) as BackupSchedule;
};

const renderSummary = (schedule: BackupSchedule) => {
	globalThis.EventSource = fromAny(MockEventSource);
	server.use(http.get("/api/v1/tasks", () => HttpResponse.json([])));
	render(
		<ScheduleSummary
			schedule={schedule}
			handleToggleEnabled={vi.fn()}
			handleRunBackupNow={vi.fn()}
			handleDeleteSchedule={vi.fn()}
		/>,
		{ withSuspense: true },
	);
};

afterEach(() => {
	cleanup();
	globalThis.EventSource = originalEventSource;
});

describe("schedule source context", () => {
	test("shows remote machine, source, and repository and gates an offline run", async () => {
		renderSummary(createSchedule("agent-filesystem", "offline"));

		expect(await screen.findByText("Studio NAS · Family photos")).toBeTruthy();
		expect(screen.getAllByText("Cloud archive")).toHaveLength(2);
		const runButton = screen.getByRole("button", { name: "Backup now" });
		expect(runButton.hasAttribute("disabled")).toBe(true);
		expect(screen.getByText("Reconnect the source machine before running this backup.")).toBeTruthy();
	});

	test("keeps local source presentation quiet and runnable", async () => {
		renderSummary(createSchedule("managed"));

		expect(await screen.findByText("Documents")).toBeTruthy();
		expect(screen.queryByText("This server")).toBeNull();
		expect(screen.getByRole("button", { name: "Backup now" }).hasAttribute("disabled")).toBe(false);
	});

	test("allows retrying a ready source after a cached health failure", async () => {
		renderSummary(createSchedule("agent-filesystem", "available", "error"));

		const runButton = await screen.findByRole("button", { name: "Backup now" });
		expect(runButton.hasAttribute("disabled")).toBe(false);
	});

	test.each(["local", "rclone"] as const)(
		"disables manual runs for legacy remote schedules using a %s repository",
		async (type) => {
			const schedule = createSchedule("agent-filesystem");
			schedule.repository.type = type;
			renderSummary(schedule);

			const runButton = await screen.findByRole("button", { name: "Backup now" });
			expect(runButton.hasAttribute("disabled")).toBe(true);
		},
	);

	test("renders source names containing the context delimiter without splitting them", () => {
		const schedule = createSchedule("agent-filesystem");
		schedule.volume.name = "Family → photos";
		const sourceLocation = schedule.volume.sourceLocation;
		if (!sourceLocation) {
			throw new Error("Expected a remote source location");
		}
		sourceLocation.machine.name = "Studio → NAS";
		render(<BackupCard schedule={schedule} isRunning={false} />);

		expect(screen.getByText("Studio → NAS · Family → photos")).toBeTruthy();
	});
});
