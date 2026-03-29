import type { ReactNode } from "react";
import { afterEach, describe, expect, mock, test } from "bun:test";
import { fromAny } from "@total-typescript/shoehorn";
import { HttpResponse, http, server } from "~/test/msw/server";
import { cleanup, render, screen } from "~/test/test-utils";

await mock.module("@tanstack/react-router", () => ({
	Link: ({ children }: { children?: ReactNode }) => <a href="/">{children}</a>,
	useNavigate: () => mock(() => {}),
	useSearch: () => ({}),
}));

await mock.module("~/client/components/backup-summary-card", () => ({
	BackupSummaryCard: () => null,
}));

await mock.module("~/client/modules/backups/components/schedule-summary", () => ({
	ScheduleSummary: () => null,
}));

await mock.module("~/client/modules/backups/components/snapshot-timeline", () => ({
	SnapshotTimeline: () => null,
}));

await mock.module("~/client/modules/backups/components/schedule-notifications-config", () => ({
	ScheduleNotificationsConfig: () => null,
}));

await mock.module("~/client/modules/backups/components/schedule-mirrors-config", () => ({
	ScheduleMirrorsConfig: () => null,
}));

await mock.module("~/client/lib/datetime", () => ({
	useTimeFormat: () => ({
		formatDateTime: () => "2026-03-26 00:00",
	}),
}));

import { ScheduleDetailsPage } from "../backup-details";

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
	time: "2026-03-26T00:00:00.000Z",
	summary: {},
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
	);
};

afterEach(() => {
	cleanup();
});

describe("ScheduleDetailsPage", () => {
	test("shows the selected snapshot from the volume root on the backup details page", async () => {
		mockScheduleDetailsRequests();

		render(
			<ScheduleDetailsPage
				loaderData={fromAny({
					schedule,
					notifs: [],
					repos: [],
					scheduleNotifs: [],
					mirrors: [],
					snapshotTimelineSortOrder: "newest",
					snapshots: [snapshot],
				})}
				scheduleId="backup-1"
				initialSnapshotId="snap-1"
				initialSnapshotSortOrder={fromAny("newest")}
			/>,
			{ withSuspense: true },
		);

		expect(await screen.findByRole("button", { name: "project" })).toBeTruthy();
	});
});
