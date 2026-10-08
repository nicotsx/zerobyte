import { HttpResponse, http, server } from "~/test/msw/server";
import { cleanup, render, screen, userEvent, waitFor } from "~/test/test-utils";
import { afterEach, expect, test } from "vitest";
import { VolumeFileBrowser } from "./volume-file-browser";

afterEach(cleanup);

test("recovers a failed folder expansion on retry", async () => {
	let nestedRequestShouldFail = true;
	server.use(
		http.get("/api/v1/volumes/source-1/files", ({ request }) => {
			const requestedPath = new URL(request.url).searchParams.get("path");
			if (requestedPath === "docs" && nestedRequestShouldFail) {
				return HttpResponse.json({ message: "Folder could not be read" }, { status: 503 });
			}
			if (requestedPath === "docs") {
				return HttpResponse.json({
					files: [{ name: "notes.txt", path: "docs/notes.txt", type: "file" }],
					offset: 0,
					limit: 100,
					hasMore: false,
				});
			}
			return HttpResponse.json({
				files: [{ name: "docs", path: "docs", type: "folder" }],
				offset: 0,
				limit: 100,
				hasMore: false,
			});
		}),
	);

	const view = render(<VolumeFileBrowser volumeId="source-1" />);
	await screen.findByText("docs");
	const expandButton = await waitFor(() => {
		const icon = view.container.querySelector<SVGElement>("svg.lucide-chevron-right");
		if (!icon) throw new Error("Folder expand control was not rendered");
		return icon;
	});
	await userEvent.click(expandButton);

	expect((await screen.findByRole("alert")).textContent).toContain("Folder could not be read");

	nestedRequestShouldFail = false;
	await userEvent.click(screen.getByRole("button", { name: /^Retry \// }));

	expect(await screen.findByText("notes.txt")).toBeTruthy();
	expect(screen.queryByRole("alert")).toBeNull();
});

test("retries the initial listing", async () => {
	let unavailable = true;
	server.use(
		http.get("/api/v1/volumes/source-1/files", () =>
			unavailable
				? HttpResponse.json({ message: "Listing unavailable" }, { status: 503 })
				: HttpResponse.json({ files: [{ name: "root.txt", path: "root.txt", type: "file" }] }),
		),
	);

	render(<VolumeFileBrowser volumeId="source-1" />);
	expect((await screen.findByRole("alert")).textContent).toContain("Listing unavailable");

	unavailable = false;
	await userEvent.click(screen.getByRole("button", { name: "Retry" }));

	expect(await screen.findByText("root.txt")).toBeTruthy();
	expect(screen.queryByRole("alert")).toBeNull();
});
