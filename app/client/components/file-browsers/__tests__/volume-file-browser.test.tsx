import { afterEach, expect, test, vi } from "vitest";
import { cleanup, render, screen, userEvent } from "~/test/test-utils";
import { HttpResponse, http, server } from "~/test/msw/server";
import { VolumeFileBrowser } from "../volume-file-browser";

afterEach(() => cleanup());

test.each(["photos", "trusted-root:photos"])(
	"browses, paginates and selects files returned with relative paths in folder %j",
	async (folderName) => {
		server.use(
			http.get("/api/v1/volumes/:shortId/files", ({ request }) => {
				const query = new URL(request.url).searchParams;
				const requestedPath = query.get("path");

				if (!requestedPath) {
					return HttpResponse.json({
						files: [{ name: folderName, path: folderName, type: "directory" }],
						hasMore: false,
					});
				}
				if (requestedPath === folderName) {
					return HttpResponse.json({
						files: [{ name: "2026", path: `${folderName}/2026`, type: "directory" }],
						hasMore: false,
					});
				}
				if (requestedPath !== `${folderName}/2026`) {
					return HttpResponse.json({ message: "Unexpected folder path" }, { status: 400 });
				}

				const nextPage = query.has("offset");
				const name = nextPage ? "second.txt" : "picture.txt";

				return HttpResponse.json({
					files: [{ name, path: `${folderName}/2026/${name}`, type: "file" }],
					offset: nextPage ? 1 : 0,
					limit: 1,
					hasMore: !nextPage,
				});
			}),
		);
		const onFileSelect = vi.fn();
		render(<VolumeFileBrowser volumeId="photos" onFileSelect={onFileSelect} />);

		await userEvent.click(await screen.findByTitle(`Expand ${folderName}`));
		await userEvent.click(await screen.findByTitle("Expand 2026"));
		await userEvent.click(await screen.findByRole("button", { name: "picture.txt" }));
		expect(onFileSelect).toHaveBeenCalledWith(`/${folderName}/2026/picture.txt`);

		await userEvent.click(await screen.findByRole("button", { name: "Load more files" }));
		expect(await screen.findByText("second.txt")).not.toBeNull();
		expect(screen.getByText("picture.txt")).not.toBeNull();
	},
);
