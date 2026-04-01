import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { fromAny } from "@total-typescript/shoehorn";
import { HttpResponse, http, server } from "~/test/msw/server";
import { cleanup, render, screen } from "~/test/test-utils";

vi.mock("@tanstack/react-router", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@tanstack/react-router")>();

	return {
		...actual,
		Link: (({ children }: { children?: ReactNode }) => <a href="/">{children}</a>) as typeof actual.Link,
		useNavigate: (() => vi.fn(async () => {})) as typeof actual.useNavigate,
		useSearch: (() => ({})) as typeof actual.useSearch,
	};
});

vi.mock("~/client/lib/datetime", async (importOriginal) => {
	const actual = await importOriginal<typeof import("~/client/lib/datetime")>();

	return {
		...actual,
		useTimeFormat: () => ({
			...actual.useTimeFormat(),
			formatDateTime: () => "2026-03-26 00:00",
		}),
	};
});

vi.mock("~/client/modules/backups/components/schedule-notifications-config", () => ({
	ScheduleNotificationsConfig: () => null,
}));

vi.mock("~/client/modules/backups/components/schedule-mirrors-config", () => ({
	ScheduleMirrorsConfig: () => null,
}));

vi.mock("~/client/modules/backups/components/schedule-summary", () => ({
	ScheduleSummary: ({ schedule }: { schedule: { name: string } }) => (
		<div>
			<h1>{schedule.name}</h1>
			<button type="button">Backup now</button>
		</div>
	),
}));

import { ScheduleDetailsPage } from "../backup-details";

class MockEventSource {
	addEventListener() {}
	close() {}
	onerror: ((event: Event) => void) | null = null;

	constructor(public url: string) {}
}

const originalEventSource = globalThis.EventSource;

const schedule = {
	shortId: "backup-1",
	name: "Backup 1",
	repositoryId: "repo-1",
	repository: { shortId: "repo-1", name: "Repo 1" },
	volume: {
		shortId: "vol-1",
		name: "Volume 1",
		config: { backend: "directory", path: "/mnt" },
	},
	enabled: true,
	cronExpression: "0 0 * * *",
	retentionPolicy: null,
	lastBackupAt: 1711411200000,
	nextBackupAt: 1711497600000,
	lastBackupStatus: null,
	lastBackupError: null,
	includePaths: ["/project"],
	includePatterns: [],
	excludePatterns: [],
	excludeIfPresent: [],
	oneFileSystem: false,
	customResticParams: [],
};

const snapshot = {
	short_id: "snap-1",
	paths: ["/mnt/project"],
	tags: ["backup-1"],
	time: new Date("2026-03-26T00:00:00.000Z").getTime(),
	size: 2097152,
	duration: 12,
	retentionCategories: [],
	summary: {
		files_new: 10,
		files_changed: 5,
		files_unmodified: 85,
		dirs_new: 2,
		dirs_changed: 1,
		dirs_unmodified: 17,
		data_blobs: 20,
		tree_blobs: 5,
		data_added: 1048576,
		data_added_packed: 524288,
		total_files_processed: 100,
		total_bytes_processed: 2097152,
		backup_start: "2026-03-26T00:00:00.000Z",
		backup_end: "2026-03-26T00:00:12.000Z",
	},
};

const mockScheduleDetailsRequests = () => {
	server.use(
		http.get("/api/v1/backups/:shortId", () => {
			return HttpResponse.json(schedule);
		}),
		http.get("/api/v1/repositories/:shortId/snapshots", () => {
			return HttpResponse.json([snapshot]);
		}),
		http.get("/api/v1/repositories/:shortId/snapshots/:snapshotId/files", () => {
			return HttpResponse.json({
				files: [
					{ name: "project", path: "/mnt/project", type: "dir" },
					{ name: "a.txt", path: "/mnt/project/a.txt", type: "file" },
				],
			});
		}),
		http.get("/api/v1/backups/:shortId/progress", () => {
			return HttpResponse.json(null);
		}),
		http.get("/api/v1/backups/:shortId/notifications", () => {
			return HttpResponse.json([]);
		}),
		http.get("/api/v1/backups/:shortId/mirrors", () => {
			return HttpResponse.json([]);
		}),
		http.get("/api/v1/backups/:shortId/mirrors/compatibility", () => {
			return HttpResponse.json([]);
		}),
	);
};

beforeEach(() => {
	globalThis.EventSource = MockEventSource as unknown as typeof EventSource;
});

afterEach(() => {
	globalThis.EventSource = originalEventSource;
	cleanup();
});

describe("ScheduleDetailsPage", () => {
	test("renders the real schedule details page with the selected snapshot", async () => {
		mockScheduleDetailsRequests();

		render(
			<ScheduleDetailsPage
				loaderData={fromAny({
					schedule,
					notifs: [],
					repos: [],
					scheduleNotifs: [],
					mirrors: [],
					snapshotTimelineSortOrder: "desc",
					snapshots: [snapshot],
				})}
				scheduleId="backup-1"
				initialSnapshotId="snap-1"
				initialSnapshotSortOrder="desc"
			/>,
			{ withSuspense: true },
		);

		expect(await screen.findByRole("heading", { name: "Backup 1" })).toBeTruthy();
		expect(screen.getByRole("button", { name: "Backup now" })).toBeTruthy();
		expect(screen.getByText("Snapshots")).toBeTruthy();
		expect(screen.getByText("Files processed")).toBeTruthy();
		expect(screen.getByRole("link", { name: /restore/i })).toBeTruthy();
		expect(await screen.findByRole("button", { name: "project" })).toBeTruthy();
	});
});
