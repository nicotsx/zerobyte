import type { ComponentProps } from "react";
import { afterEach, describe, expect, test } from "vitest";
import { HttpResponse, http, server } from "~/test/msw/server";
import { cleanup, fireEvent, render, screen, userEvent, waitFor, within } from "~/test/test-utils";
import { VolumeFileBrowser } from "../volume-file-browser";

type VolumeFilesRequest = {
	shortId: string;
	path: string | null;
	offset: string | null;
};

const renderVolumeFileBrowser = (props: Partial<ComponentProps<typeof VolumeFileBrowser>> = {}) => {
	return render(<VolumeFileBrowser volumeId="volume-1" {...props} />);
};

afterEach(() => {
	cleanup();
});

describe("VolumeFileBrowser", () => {
	test("returns literal selected paths when the volume API uses encoded navigation paths", async () => {
		server.use(
			http.get("/api/v1/volumes/:shortId/files", () => {
				return HttpResponse.json({
					files: [{ name: "movies [1]", path: "/movies%20%5B1%5D", type: "directory" }],
					path: "/",
					offset: 0,
					limit: 500,
					total: 1,
					hasMore: false,
				});
			}),
		);

		let selectedPaths: Set<string> | undefined;
		renderVolumeFileBrowser({
			withCheckboxes: true,
			onSelectionChange: (paths) => {
				selectedPaths = paths;
			},
		});

		const row = await screen.findByRole("button", { name: "movies [1]" });
		await userEvent.click(within(row).getByRole("checkbox"));

		expect(selectedPaths ? Array.from(selectedPaths) : []).toEqual(["/movies [1]"]);
	});

	test("uses encoded paths when fetching an expanded folder's children", async () => {
		const requests: VolumeFilesRequest[] = [];

		server.use(
			http.get("/api/v1/volumes/:shortId/files", ({ params, request }) => {
				const url = new URL(request.url);
				const requestPath = url.searchParams.get("path");
				requests.push({
					shortId: String(params.shortId),
					path: requestPath,
					offset: url.searchParams.get("offset"),
				});

				if (requestPath === "/movies%20%5B1%5D") {
					return HttpResponse.json({
						files: [{ name: "clip.txt", path: "/movies%20%5B1%5D/clip.txt", type: "file" }],
						path: "/movies%20%5B1%5D",
						offset: 0,
						limit: 500,
						total: 1,
						hasMore: false,
					});
				}

				return HttpResponse.json({
					files: [{ name: "movies [1]", path: "/movies%20%5B1%5D", type: "directory" }],
					path: "/",
					offset: 0,
					limit: 500,
					total: 1,
					hasMore: false,
				});
			}),
		);

		renderVolumeFileBrowser();

		const row = await screen.findByRole("button", { name: "movies [1]" });
		const expandIcon = row.querySelector("svg");
		if (!expandIcon) {
			throw new Error("Expected expand icon for folder row");
		}
		fireEvent.click(expandIcon);

		await waitFor(() => {
			expect(requests).toEqual([
				{ shortId: "volume-1", path: null, offset: null },
				{ shortId: "volume-1", path: "/movies%20%5B1%5D", offset: null },
			]);
		});
	});
});
