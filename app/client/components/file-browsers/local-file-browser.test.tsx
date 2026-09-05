import { afterEach, expect, test } from "vitest";
import { HttpResponse, http, server } from "~/test/msw/server";
import { cleanup, render, screen, userEvent, waitFor } from "~/test/test-utils";
import { LocalFileBrowser } from "./local-file-browser";

afterEach(cleanup);

test("renders trusted browse results and expands them through local browser paths", async () => {
	const requestedPaths: Array<string | null> = [];
	server.use(
		http.get("/api/v1/volumes/filesystem/browse", ({ request }) => {
			const url = new URL(request.url);
			const requestedPath = url.searchParams.get("path");
			requestedPaths.push(requestedPath);

			if (requestedPath === "/") {
				return HttpResponse.json({
					path: "trusted-root:",
					directories: [{ name: "albums", path: "trusted-root:albums", type: "directory" }],
				});
			}
			if (requestedPath === "/albums") {
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
	const expandIcon = albums.querySelector("svg");
	if (!expandIcon) {
		throw new Error("Expected expand icon for albums");
	}
	await userEvent.click(expandIcon);

	expect(await screen.findByRole("button", { name: "summer" })).toBeTruthy();
	await waitFor(() => {
		expect(requestedPaths[0]).toBe("/");
		expect(requestedPaths).toContain("/albums");
		expect(requestedPaths).not.toContain("trusted-root:");
		expect(requestedPaths).not.toContain("trusted-root:albums");
	});
});
