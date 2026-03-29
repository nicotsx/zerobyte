import type { ReactNode } from "react";
import { afterEach, describe, expect, mock, test } from "bun:test";
import { HttpResponse, http, server } from "~/test/msw/server";
import { cleanup, render, screen, waitFor } from "~/test/test-utils";
import { fromAny } from "@total-typescript/shoehorn";

await mock.module("@tanstack/react-router", () => ({
	Link: ({ children }: { children?: ReactNode }) => <a href="/">{children}</a>,
}));

await mock.module("~/client/lib/datetime", () => ({
	useTimeFormat: () => ({
		formatDateTime: () => "2026-03-26 00:00",
	}),
}));

import { SnapshotFileBrowser } from "../snapshot-file-browser";

afterEach(() => {
	cleanup();
});

describe("SnapshotFileBrowser", () => {
	test("uses the snapshot common ancestor as query root while keeping a broader display root", async () => {
		const requests: string[] = [];

		server.use(
			http.get("/api/v1/repositories/:shortId/snapshots/:snapshotId/files", ({ request }) => {
				const url = new URL(request.url);
				requests.push(url.searchParams.get("path") ?? "");

				return HttpResponse.json({
					files: [
						{ name: "subdir", path: "/mnt/project/subdir", type: "dir" },
						{ name: "a.txt", path: "/mnt/project/subdir/a.txt", type: "file" },
					],
				});
			}),
		);

		render(
			<SnapshotFileBrowser
				snapshot={fromAny({
					short_id: "snap-1",
					time: "2026-03-26T00:00:00.000Z",
					paths: ["/mnt/project/subdir/a.txt", "/mnt/project/subdir/b.txt"],
				})}
				repositoryId="repo-1"
				backupId="backup-1"
				displayBasePath="/mnt"
			/>,
		);

		await waitFor(() => {
			expect(requests[0]).toBe("/mnt/project/subdir");
		});

		expect(await screen.findByRole("button", { name: "project" })).toBeTruthy();
	});
});
