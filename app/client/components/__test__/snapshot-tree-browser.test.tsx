import { afterEach, expect, test } from "vitest";
import { SnapshotTreeBrowser } from "../file-browsers/snapshot-tree-browser";
import { HttpResponse, http, server } from "~/test/msw/server";
import { cleanup, render, screen, userEvent, waitFor } from "~/test/test-utils";

afterEach(cleanup);

test("keeps keyboard focus through folder loading and preserves loaded contents when toggling", async () => {
	const folderResponse = Promise.withResolvers<void>();
	server.use(
		http.get("/api/v1/repositories/:shortId/snapshots/:snapshotId/files", async ({ request }) => {
			const path = new URL(request.url).searchParams.get("path");
			if (path === "/root") {
				await folderResponse.promise;
				return HttpResponse.json({
					files: [
						{ name: "first.txt", path: "/root/first.txt", type: "file" },
						{ name: "nested", path: "/root/nested", type: "dir" },
					],
				});
			}
			return HttpResponse.json({ files: [{ name: "root", path: "/root", type: "dir" }] });
		}),
	);

	render(<SnapshotTreeBrowser repositoryId="repo-1" snapshotId="snap-1" />);
	const toggle = await screen.findByRole("button", { name: "Expand folder" });
	toggle.focus();

	try {
		await userEvent.keyboard("{Enter}");
		expect(document.activeElement).toBe(toggle);
		expect(toggle.getAttribute("aria-busy")).toBe("true");
		expect(toggle.getAttribute("aria-expanded")).toBe("true");

		await userEvent.keyboard("{Enter}");
		expect(toggle.getAttribute("aria-expanded")).toBe("true");
	} finally {
		folderResponse.resolve();
	}

	expect(await screen.findByText("first.txt")).toBeTruthy();
	expect(screen.getByRole("button", { name: "Expand folder" })).toBeTruthy();
	await waitFor(() => expect(toggle.getAttribute("aria-busy")).toBe("false"));
	expect(document.activeElement).toBe(toggle);

	await userEvent.keyboard("{Enter}");
	expect(screen.queryByText("first.txt")).toBeNull();
	expect(toggle.getAttribute("aria-expanded")).toBe("false");
	await userEvent.keyboard("{Enter}");
	expect(screen.getByText("first.txt")).toBeTruthy();
	expect(toggle.getAttribute("aria-busy")).toBe("false");
});
