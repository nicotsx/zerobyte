import { afterEach, expect, test, vi } from "vitest";
import { HttpResponse, http, server } from "~/test/msw/server";
import { cleanup, render, screen, userEvent } from "~/test/test-utils";
import { LocalFileBrowser } from "./local-file-browser";

afterEach(cleanup);

test("browses relative source paths while selecting absolute host directories", async () => {
	server.use(
		http.get("/api/v1/volumes/filesystem/browse", ({ request }) => {
			const path = new URL(request.url).searchParams.get("path");
			if (path === "") {
				return HttpResponse.json({
					path: "",
					directories: [{ name: "test-data", path: "test-data", type: "directory" }],
				});
			}
			return HttpResponse.json({ message: "Trusted source path must be relative" }, { status: 400 });
		}),
	);

	const onFolderSelect = vi.fn();

	render(<LocalFileBrowser selectableFolders onFolderSelect={onFolderSelect} />);
	await userEvent.click(await screen.findByRole("button", { name: "test-data" }));

	expect(onFolderSelect).toHaveBeenCalledWith("/test-data");
});
