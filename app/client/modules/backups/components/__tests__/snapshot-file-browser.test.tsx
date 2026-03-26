import type { ReactNode } from "react";
import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, render, screen } from "@testing-library/react";
import { fromAny } from "@total-typescript/shoehorn";

await mock.module("@tanstack/react-router", () => ({
	Link: ({ children }: { children?: ReactNode }) => <a href="/">{children}</a>,
}));

await mock.module("~/client/components/file-browsers/snapshot-tree-browser", () => ({
	SnapshotTreeBrowser: ({ queryBasePath, displayBasePath }: { queryBasePath?: string; displayBasePath?: string }) => (
		<div>{`query:${queryBasePath ?? "missing"} display:${displayBasePath ?? "missing"}`}</div>
	),
}));

await mock.module("~/client/lib/datetime", () => ({
	useTimeFormat: () => ({
		formatDateTime: () => "2026-03-26 00:00",
	}),
}));

import { SnapshotFileBrowser } from "../snapshot-file-browser";

afterEach(() => {
	cleanup();
	mock.restore();
});

describe("SnapshotFileBrowser", () => {
	test("uses the snapshot common ancestor as query root while keeping a broader display root", () => {
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

		expect(screen.getByText("query:/mnt/project/subdir display:/mnt")).toBeTruthy();
	});
});
