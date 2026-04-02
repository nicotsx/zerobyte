import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { HttpResponse, http, server } from "~/test/msw/server";
import { cleanup, render, screen, userEvent, waitFor, within } from "~/test/test-utils";
import { fromAny } from "@total-typescript/shoehorn";

vi.mock("@tanstack/react-router", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@tanstack/react-router")>();

	return {
		...actual,
		useNavigate: (() => vi.fn(async () => {})) as typeof actual.useNavigate,
	};
});

import { RestoreForm } from "../restore-form";

class MockEventSource {
	addEventListener() {}
	close() {}
	onerror: ((event: Event) => void) | null = null;

	constructor(public url: string) {}
}

const originalEventSource = globalThis.EventSource;

beforeEach(() => {
	globalThis.EventSource = MockEventSource as unknown as typeof EventSource;
});

afterEach(() => {
	globalThis.EventSource = originalEventSource;
	cleanup();
});

describe("RestoreForm", () => {
	test("restores the selected ancestor folder path from a broader display root", async () => {
		let restoreRequestBody: unknown;

		server.use(
			http.get("/api/v1/repositories/:shortId/snapshots/:snapshotId/files", () => {
				return HttpResponse.json({
					files: [
						{ name: "subdir", path: "/mnt/project/subdir", type: "dir" },
						{ name: "deep.tx", path: "/mnt/project/subdir/deep.tx", type: "file" },
					],
				});
			}),
			http.post("/api/v1/repositories/:shortId/restore", async ({ request }) => {
				restoreRequestBody = await request.json();
				return HttpResponse.json({
					success: true,
					message: "Snapshot restored successfully",
					filesRestored: 1,
					filesSkipped: 0,
				});
			}),
		);

		render(
			<RestoreForm
				repository={fromAny({ shortId: "repo-1", name: "Repo 1" })}
				snapshotId="snap-1"
				returnPath="/repositories/repo-1/snap-1"
				queryBasePath="/mnt/project/subdir"
				displayBasePath="/mnt"
			/>,
		);

		const row = await screen.findByRole("button", { name: "project" });
		await userEvent.click(within(row).getByRole("checkbox"));
		await userEvent.click(screen.getByRole("button", { name: "Restore 1 item" }));

		await waitFor(() => {
			expect(restoreRequestBody).toEqual({
				snapshotId: "snap-1",
				include: ["/mnt/project"],
				selectedItemKind: "dir",
				overwrite: "always",
			});
		});
	});

	test("restores the selected full path when the display root is unrelated", async () => {
		let restoreRequestBody: unknown;

		server.use(
			http.get("/api/v1/repositories/:shortId/snapshots/:snapshotId/files", () => {
				return HttpResponse.json({
					files: [
						{ name: "project", path: "/mnt/project", type: "dir" },
						{ name: "a.txt", path: "/mnt/project/a.txt", type: "file" },
					],
				});
			}),
			http.post("/api/v1/repositories/:shortId/restore", async ({ request }) => {
				restoreRequestBody = await request.json();
				return HttpResponse.json({
					success: true,
					message: "Snapshot restored successfully",
					filesRestored: 1,
					filesSkipped: 0,
				});
			}),
			http.get("/api/v1/volumes/filesystem/browse", () => {
				return HttpResponse.json({
					path: "/",
					directories: [{ name: "restore-target", path: "/restore-target", type: "dir" }],
				});
			}),
		);

		render(
			<RestoreForm
				repository={fromAny({ shortId: "repo-1", name: "Repo 1" })}
				snapshotId="snap-1"
				returnPath="/repositories/repo-1/snap-1"
				queryBasePath="/mnt/project"
				displayBasePath="/other/root"
			/>,
		);

		expect(
			screen.getByText(
				"This snapshot was created from source paths that do not match this Zerobyte server or the current linked volume. Restoring to the original location is unavailable. Restore it to a custom location, or download it instead.",
			),
		).toBeTruthy();
		expect(screen.getByRole("button", { name: "Original location" }).hasAttribute("disabled")).toBe(true);
		expect(screen.getByRole("button", { name: "Restore All" }).hasAttribute("disabled")).toBe(true);

		await userEvent.click(screen.getByRole("button", { name: "Change" }));
		await userEvent.click(await screen.findByRole("button", { name: "restore-target" }));
		await waitFor(() => {
			expect(screen.getByRole("button", { name: "Restore All" }).hasAttribute("disabled")).toBe(false);
		});

		const row = await screen.findByRole("button", { name: "mnt" });
		await userEvent.click(within(row).getByRole("checkbox"));
		await waitFor(() => {
			expect(screen.getByRole("button", { name: "Restore 1 item" }).hasAttribute("disabled")).toBe(false);
		});

		await userEvent.click(screen.getByRole("button", { name: "Restore 1 item" }));

		await waitFor(() => {
			expect(restoreRequestBody).toEqual({
				snapshotId: "snap-1",
				include: ["/mnt"],
				selectedItemKind: "dir",
				targetPath: "/restore-target",
				overwrite: "always",
			});
		});
	});
});
