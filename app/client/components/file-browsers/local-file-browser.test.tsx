import { afterEach, expect, test } from "vitest";
import { HttpResponse, http, server } from "~/test/msw/server";
import { cleanup, render, screen, userEvent, waitFor } from "~/test/test-utils";
import { LocalFileBrowser } from "./local-file-browser";

afterEach(cleanup);

const literalPathCases = ["space%20name", "encoded%2Fslash", "double%2520encoded", "trusted-root:photos"];

test("renders trusted browse results and expands them through local browser paths", async () => {
	const requestedPaths: Array<string | null> = [];
	server.use(
		http.get("/api/v1/volumes/filesystem/browse", ({ request }) => {
			const url = new URL(request.url);
			const requestedPath = url.searchParams.get("path");
			requestedPaths.push(requestedPath);

			if (requestedPath === "") {
				return HttpResponse.json({
					path: "",
					directories: [{ name: "albums", path: "albums", type: "directory" }],
				});
			}
			if (requestedPath === "albums") {
				return HttpResponse.json({
					path: "albums",
					directories: [{ name: "summer", path: "albums/summer", type: "directory" }],
				});
			}

			return new HttpResponse(null, { status: 404 });
		}),
	);

	render(<LocalFileBrowser initialPath="" />);
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
	});
});

test.each(literalPathCases)("preserves literal folder names in %s", async (directoryPath) => {
	const requestedPaths: Array<string | null> = [];
	server.use(
		http.get("/api/v1/volumes/filesystem/browse", ({ request }) => {
			const url = new URL(request.url);
			const requestedPath = url.searchParams.get("path");
			requestedPaths.push(requestedPath);

			if (requestedPath === "") {
				return HttpResponse.json({
					path: "",
					directories: [{ name: directoryPath, path: `${directoryPath}`, type: "directory" }],
				});
			}
			if (requestedPath === directoryPath) {
				return HttpResponse.json({ path: `${directoryPath}`, directories: [] });
			}

			return new HttpResponse(null, { status: 404 });
		}),
	);

	render(<LocalFileBrowser initialPath="" />);
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

test("scopes trusted-root browsing to the agent and retries the initial load", async () => {
	let canBrowse = false;
	const requestedRoots: Array<string | null> = [];
	server.use(
		http.get("/api/v1/volumes/filesystem/browse", ({ request }) => {
			requestedRoots.push(new URL(request.url).searchParams.get("rootId"));

			return canBrowse
				? HttpResponse.json({ path: "", directories: [{ name: "albums", path: "albums", type: "directory" }] })
				: HttpResponse.json({ message: "Machine is offline" }, { status: 503 });
		}),
	);

	render(<LocalFileBrowser trustedRoot={{ agentId: "archive", rootId: "photos" }} />);
	expect(await screen.findByText("Machine is offline")).toBeTruthy();

	canBrowse = true;
	await userEvent.click(screen.getByRole("button", { name: "Retry" }));

	expect(await screen.findByRole("button", { name: "albums" })).toBeTruthy();
	expect(requestedRoots.every((rootId) => rootId === "photos")).toBe(true);
});
