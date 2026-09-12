import { afterEach, expect, test, vi } from "vitest";
import { fromPartial } from "@total-typescript/shoehorn";
import { cleanup, render, screen, userEvent, waitFor } from "~/test/test-utils";
import { FolderAccessError } from "../folder-access-error";
import { VolumeFileBrowser } from "../volume-file-browser";
import { SnapshotTreeBrowser } from "../snapshot-tree-browser";
import { HttpResponse, http, server } from "~/test/msw/server";

afterEach(() => {
	cleanup();
	delete window.zerobyteDesktop;
});

test("offers Mac privacy settings for a denied folder", async () => {
	const openPrivacySettings = vi.fn().mockResolvedValue(undefined);
	render(
		<FolderAccessError
			message="Failed to list files: EPERM: operation not permitted, scandir Downloads"
			openPrivacySettings={openPrivacySettings}
		/>,
	);
	expect(screen.getByRole("alert").textContent).toContain("Access to this folder was denied.");
	await userEvent.click(screen.getByRole("button", { name: "Open Privacy Settings" }));
	expect(openPrivacySettings).toHaveBeenCalledTimes(1);
});

test("does not offer Mac settings without a recovery action", () => {
	render(<FolderAccessError message="EACCES: permission denied" />);
	expect(screen.getByRole("alert").textContent).toContain("Access to this folder was denied.");
	expect(screen.queryByRole("button", { name: "Open Privacy Settings" })).toBeNull();
});

test("preserves unrelated errors without suggesting privacy settings", () => {
	render(<FolderAccessError message="Directory not found" openPrivacySettings={vi.fn()} />);
	expect(screen.getByRole("alert").textContent).toContain("Directory not found");
	expect(screen.queryByRole("button")).toBeNull();
});

test("shows denied expansion beside the tree and allows a subsequent successful expansion", async () => {
	window.zerobyteDesktop = fromPartial({ openPrivacySettings: vi.fn().mockResolvedValue(undefined) });
	let denied = true;
	server.use(
		http.get("/api/v1/volumes/:shortId/files", ({ request }) => {
			const path = new URL(request.url).searchParams.get("path");
			if (path && denied)
				return HttpResponse.json({ message: "EPERM: operation not permitted" }, { status: 500 });
			return HttpResponse.json({
				files: path
					? [{ name: "example.txt", path: "/Downloads/example.txt", type: "file" }]
					: [{ name: "Downloads", path: "/Downloads", type: "directory" }],
				hasMore: false,
			});
		}),
	);
	render(<VolumeFileBrowser volumeId="test-volume" />);
	await userEvent.click(await screen.findByRole("button", { name: "Expand folder" }));
	expect(await screen.findByText("Access to this folder was denied.")).not.toBeNull();
	expect(screen.getByText("Downloads")).not.toBeNull();
	expect(screen.getByRole("button", { name: "Open Privacy Settings" })).not.toBeNull();
	denied = false;
	await userEvent.click(screen.getByRole("button", { name: "Collapse folder" }));
	await userEvent.click(screen.getByRole("button", { name: "Expand folder" }));
	expect(await screen.findByText("example.txt")).not.toBeNull();
	expect(screen.queryByText("Access to this folder was denied.")).toBeNull();
});

test.each([true, false])("folder hover prefetch respects desktop=%s", async (desktop) => {
	if (desktop) window.zerobyteDesktop = fromPartial({ chooseFolder: vi.fn() });
	server.use(
		http.get("/api/v1/volumes/:shortId/files", () =>
			HttpResponse.json({
				files: [{ name: "Downloads", path: "/Downloads", type: "directory" }],
				hasMore: false,
			}),
		),
	);
	const { queryClient } = render(<VolumeFileBrowser volumeId="hover-volume" />);
	const prefetch = vi.spyOn(queryClient, "prefetchQuery");
	await userEvent.hover(await screen.findByRole("button", { name: "Downloads" }));
	expect(prefetch).toHaveBeenCalledTimes(desktop ? 0 : 1);
});

test("keeps each denied folder's error when other folders are expanded", async () => {
	server.use(
		http.get("/api/v1/volumes/:shortId/files", ({ request }) => {
			const path = new URL(request.url).searchParams.get("path");
			if (path === "/Denied" || path === "/AlsoDenied") {
				return HttpResponse.json({ message: "EACCES: permission denied" }, { status: 500 });
			}
			return HttpResponse.json({
				files: path
					? [{ name: "ok.txt", path: "/Other/ok.txt", type: "file" }]
					: [
							{ name: "Denied", path: "/Denied", type: "directory" },
							{ name: "AlsoDenied", path: "/AlsoDenied", type: "directory" },
							{ name: "Other", path: "/Other", type: "directory" },
						],
				hasMore: false,
			});
		}),
	);
	render(<VolumeFileBrowser volumeId="siblings" />);
	await userEvent.click(await screen.findByTitle("Expand Denied"));
	await screen.findByRole("alert");
	await userEvent.click(screen.getByTitle("Expand AlsoDenied"));
	await waitFor(() => expect(screen.getAllByRole("alert")).toHaveLength(2));
	await userEvent.click(screen.getByTitle("Expand Other"));
	await screen.findByText("ok.txt");
	expect(screen.getAllByRole("alert")).toHaveLength(2);
});

test.each(["/", "/Folder"])("shows pagination failure for %s and clears it after retry", async (folderPath) => {
	let denied = true;
	server.use(
		http.get("/api/v1/volumes/:shortId/files", ({ request }) => {
			const query = new URL(request.url).searchParams;
			if (folderPath !== "/" && !query.has("path")) {
				return HttpResponse.json({
					files: [{ name: "Folder", path: folderPath, type: "directory" }],
					hasMore: false,
				});
			}
			if (query.has("offset") && denied) {
				return HttpResponse.json({ message: "EACCES: permission denied" }, { status: 500 });
			}
			const name = query.has("offset") ? "second.txt" : "first.txt";
			return HttpResponse.json({
				files: [{ name, path: `${folderPath === "/" ? "" : folderPath}/${name}`, type: "file" }],
				offset: query.has("offset") ? 1 : 0,
				limit: 1,
				hasMore: !query.has("offset"),
			});
		}),
	);
	render(<VolumeFileBrowser volumeId="pagination" />);
	if (folderPath !== "/") await userEvent.click(await screen.findByTitle("Expand Folder"));
	await userEvent.click(await screen.findByRole("button", { name: "Load more files" }));
	expect(await screen.findByRole("alert")).not.toBeNull();
	expect(screen.getByText("first.txt")).not.toBeNull();
	denied = false;
	await userEvent.click(screen.getByRole("button", { name: "Load more files" }));
	await screen.findByText("second.txt");
	expect(screen.queryByRole("alert")).toBeNull();
});

test.each(["/", "/Folder"])(
	"preserves snapshot errors at %s without offering local privacy settings",
	async (failedPath) => {
		window.zerobyteDesktop = fromPartial({ openPrivacySettings: vi.fn() });
		const message = "EPERM: repository cache is not readable";
		server.use(
			http.get("/api/v1/repositories/:shortId/snapshots/:snapshotId/files", ({ request }) => {
				if (new URL(request.url).searchParams.get("path") === failedPath) {
					return HttpResponse.json({ message }, { status: 500 });
				}
				return HttpResponse.json({ files: [{ name: "Folder", path: "/Folder", type: "dir" }], hasMore: false });
			}),
		);
		render(<SnapshotTreeBrowser repositoryId="repo" snapshotId="snapshot" />);
		if (failedPath !== "/") await userEvent.click(await screen.findByTitle("Expand Folder"));
		expect((await screen.findByRole("alert")).textContent).toBe(message);
		expect(screen.queryByRole("button", { name: "Open Privacy Settings" })).toBeNull();
	},
);
