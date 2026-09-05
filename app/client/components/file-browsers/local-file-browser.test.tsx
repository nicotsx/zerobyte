import { afterEach, expect, test } from "vitest";
import { HttpResponse, http, server } from "~/test/msw/server";
import { cleanup, render, screen, userEvent, waitFor } from "~/test/test-utils";
import { LocalFileBrowser } from "./local-file-browser";

afterEach(cleanup);

const literalPathCases = ["space%20name", "encoded%2Fslash", "double%2520encoded"];

test("renders trusted browse results and expands them through local browser paths", async () => {
	const requestedPaths: Array<string | null> = [];
	server.use(
		http.get("/api/v1/volumes/filesystem/browse", ({ request }) => {
			const url = new URL(request.url);
			const requestedPath = url.searchParams.get("path");
			requestedPaths.push(requestedPath);

			if (requestedPath === "") {
				return HttpResponse.json({
					path: "trusted-root:",
					directories: [{ name: "albums", path: "trusted-root:albums", type: "directory" }],
				});
			}
			if (requestedPath === "albums") {
				return HttpResponse.json({
					path: "trusted-root:albums",
					directories: [{ name: "summer", path: "trusted-root:albums/summer", type: "directory" }],
				});
			}

			return new HttpResponse(null, { status: 404 });
		}),
	);

	render(<LocalFileBrowser initialPath="trusted-root:" />);
	const albums = await screen.findByRole("button", { name: "albums" });
	const expandIcon = await waitFor(() => {
		const collapsedIcon = albums.querySelector("svg.lucide-chevron-right");
		if (!collapsedIcon) {
			throw new Error("Expected expand icon for albums");
		}
		return collapsedIcon;
	});
	await userEvent.click(expandIcon);

	expect(await screen.findByRole("button", { name: "summer" })).toBeTruthy();
	await waitFor(() => {
		expect(requestedPaths[0]).toBe("");
		expect(requestedPaths).toContain("albums");
		expect(requestedPaths).not.toContain("trusted-root:");
		expect(requestedPaths).not.toContain("trusted-root:albums");
	});
});

test.each(literalPathCases)("preserves literal percent sequences in %s", async (directoryPath) => {
	const requestedPaths: Array<string | null> = [];
	server.use(
		http.get("/api/v1/volumes/filesystem/browse", ({ request }) => {
			const url = new URL(request.url);
			const requestedPath = url.searchParams.get("path");
			requestedPaths.push(requestedPath);

			if (requestedPath === "") {
				return HttpResponse.json({
					path: "trusted-root:",
					directories: [{ name: directoryPath, path: `trusted-root:${directoryPath}`, type: "directory" }],
				});
			}
			if (requestedPath === directoryPath) {
				return HttpResponse.json({ path: `trusted-root:${directoryPath}`, directories: [] });
			}

			return new HttpResponse(null, { status: 404 });
		}),
	);

	render(<LocalFileBrowser initialPath="trusted-root:" />);
	const directory = await screen.findByRole("button", { name: directoryPath });
	const expandIcon = await waitFor(() => {
		const collapsedIcon = directory.querySelector("svg.lucide-chevron-right");
		if (!collapsedIcon) {
			throw new Error("Expected expand icon for literal path directory");
		}
		return collapsedIcon;
	});
	await userEvent.click(expandIcon);

	await waitFor(() => {
		expect(requestedPaths).toContain(directoryPath);
	});
});
