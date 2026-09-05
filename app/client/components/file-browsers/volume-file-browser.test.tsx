import { HttpResponse, http, server } from "~/test/msw/server";
import { cleanup, render, screen, userEvent, waitFor } from "~/test/test-utils";
import { afterEach, describe, expect, test } from "vitest";
import { VolumeFileBrowser } from "./volume-file-browser";

const requestErrorMessage = "Files could not be loaded. Check the source availability and try again.";
const genericRequestErrorMessage = "Files could not be loaded. Try again.";
const browserCases = [
	{ sourceKind: "remote", requestErrorMessage, expectedMessage: requestErrorMessage },
	{ sourceKind: "managed", requestErrorMessage: undefined, expectedMessage: genericRequestErrorMessage },
] as const;

afterEach(cleanup);

describe("VolumeFileBrowser request errors", () => {
	test.each(browserCases)(
		"shows a safe nested-folder error for a $sourceKind source and recovers on retry",
		async ({ requestErrorMessage: suppliedErrorMessage, expectedMessage }) => {
			let nestedRequestShouldFail = true;
			server.use(
				http.get("/api/v1/volumes/source-1/files", ({ request }) => {
					const requestedPath = new URL(request.url).searchParams.get("path");
					if (requestedPath === "/docs" && nestedRequestShouldFail) {
						return HttpResponse.json({ message: "/private/agent/docs could not be read" }, { status: 503 });
					}
					if (requestedPath === "/docs") {
						return HttpResponse.json({
							files: [{ name: "notes.txt", path: "/docs/notes.txt", type: "file" }],
							offset: 0,
							limit: 100,
							hasMore: false,
						});
					}
					return HttpResponse.json({
						files: [{ name: "docs", path: "/docs", type: "folder" }],
						offset: 0,
						limit: 100,
						hasMore: false,
					});
				}),
			);

			const view = render(<VolumeFileBrowser volumeId="source-1" requestErrorMessage={suppliedErrorMessage} />);
			await screen.findByText("docs");
			await waitFor(() => {
				const expandButton = view.container.querySelector(
					"svg.lucide-chevron-right, svg.lucide-chevron-right-icon",
				);
				expect(expandButton).toBeTruthy();
			});
			const expandButton = view.container.querySelector<SVGElement>(
				"svg.lucide-chevron-right, svg.lucide-chevron-right-icon",
			);
			if (!expandButton) {
				throw new Error("Folder expand control was not rendered");
			}
			await userEvent.click(expandButton);

			expect((await screen.findByRole("alert")).textContent).toContain(expectedMessage);
			expect(document.body.textContent).not.toContain("/private/agent");

			nestedRequestShouldFail = false;
			await userEvent.click(screen.getByRole("button", { name: /^Retry \// }));
			expect(await screen.findByText("notes.txt")).toBeTruthy();
			expect(screen.queryByRole("alert")).toBeNull();
		},
	);

	test.each(browserCases)(
		"shows a safe pagination error for a $sourceKind source and recovers on retry",
		async ({ requestErrorMessage: suppliedErrorMessage, expectedMessage }) => {
			let paginationShouldFail = true;
			server.use(
				http.get("/api/v1/volumes/source-1/files", ({ request }) => {
					const offset = new URL(request.url).searchParams.get("offset");
					if (offset === "1" && paginationShouldFail) {
						return HttpResponse.json({ message: "agent /private/page failed" }, { status: 503 });
					}
					if (offset === "1") {
						return HttpResponse.json({
							files: [{ name: "second.txt", path: "/second.txt", type: "file" }],
							offset: 1,
							limit: 1,
							hasMore: false,
						});
					}
					return HttpResponse.json({
						files: [{ name: "first.txt", path: "/first.txt", type: "file" }],
						offset: 0,
						limit: 1,
						hasMore: true,
					});
				}),
			);

			render(<VolumeFileBrowser volumeId="source-1" requestErrorMessage={suppliedErrorMessage} />);
			await userEvent.click(await screen.findByText("Load more files"));

			expect((await screen.findByRole("alert")).textContent).toContain(expectedMessage);
			expect(document.body.textContent).not.toContain("/private/page");

			paginationShouldFail = false;
			await userEvent.click(screen.getByRole("button", { name: /^Retry \// }));
			await waitFor(() => expect(screen.getByText("second.txt")).toBeTruthy());
			expect(screen.queryByRole("alert")).toBeNull();
		},
	);

	test.each([
		{ operation: "expand", loadUnrelatedFolder: false },
		{ operation: "expand", loadUnrelatedFolder: true },
		{ operation: "load-more", loadUnrelatedFolder: false },
		{ operation: "load-more", loadUnrelatedFolder: true },
	])(
		"retries A's $operation after B fails (C loaded: $loadUnrelatedFolder)",
		async ({ operation, loadUnrelatedFolder }) => {
			const failingFolders = new Set(["/A", "/B"]);
			server.use(
				http.get("/api/v1/volumes/source-1/files", ({ request }) => {
					const params = new URL(request.url).searchParams;
					const path = params.get("path");
					const offset = Number(params.get("offset") ?? 0);

					if (!path) {
						return HttpResponse.json({
							files: ["A", "B", "C"].map((name) => ({ name, path: `/${name}`, type: "folder" })),
							hasMore: false,
						});
					}

					const isFirstPageOfA = path === "/A" && operation === "load-more" && offset === 0;
					if (failingFolders.has(path) && !isFirstPageOfA) {
						return HttpResponse.json({ message: `/private/agent${path} failed` }, { status: 503 });
					}

					const name = isFirstPageOfA ? "first-A.txt" : `loaded-${path.slice(1)}.txt`;
					return HttpResponse.json({
						files: [{ name, path: `${path}/${name}`, type: "file" }],
						offset,
						limit: 1,
						hasMore: isFirstPageOfA,
					});
				}),
			);

			render(<VolumeFileBrowser volumeId="source-1" requestErrorMessage={requestErrorMessage} />);
			await userEvent.click(await screen.findByTitle("Expand A"));
			if (operation === "load-more") {
				await userEvent.click(await screen.findByRole("button", { name: "Load more files" }));
			}
			await screen.findByRole("button", { name: "Retry /A" });
			await userEvent.click(screen.getByTitle("Expand B"));
			await screen.findByRole("button", { name: "Retry /B" });

			if (loadUnrelatedFolder) {
				await userEvent.click(screen.getByTitle("Expand C"));
				await screen.findByText("loaded-C.txt");
			}

			expect(screen.getAllByRole("alert").map((alert) => alert.textContent)).toEqual([
				requestErrorMessage,
				requestErrorMessage,
			]);
			expect(document.body.textContent).not.toContain("/private/agent");

			failingFolders.clear();
			await userEvent.click(screen.getByRole("button", { name: "Retry /A" }));
			expect(await screen.findByText("loaded-A.txt")).toBeTruthy();
			expect(screen.queryByText("loaded-B.txt")).toBeNull();
			expect(screen.getByRole("button", { name: "Retry /B" })).toBeTruthy();
			expect(screen.queryByRole("button", { name: "Retry /A" })).toBeNull();
			expect(screen.getByRole("alert").textContent).toBe(requestErrorMessage);
			if (operation === "load-more") {
				expect(screen.getByText("first-A.txt")).toBeTruthy();
				expect(screen.queryByRole("button", { name: "Load more files" })).toBeNull();
			}

			await userEvent.click(screen.getByRole("button", { name: "Retry /B" }));
			expect(await screen.findByText("loaded-B.txt")).toBeTruthy();
			expect(screen.queryByRole("alert")).toBeNull();
		},
	);

	test("retries the initial listing separately from folder requests", async () => {
		let unavailable = true;
		server.use(
			http.get("/api/v1/volumes/source-1/files", ({ request }) => {
				if (unavailable || new URL(request.url).searchParams.has("path")) {
					return HttpResponse.json({ message: "Listing unavailable" }, { status: 503 });
				}
				return HttpResponse.json({ files: [{ name: "root.txt", path: "/root.txt", type: "file" }] });
			}),
		);

		render(<VolumeFileBrowser volumeId="source-1" requestErrorMessage={requestErrorMessage} />);
		expect((await screen.findByRole("alert")).textContent).toBe(requestErrorMessage);
		unavailable = false;
		await userEvent.click(screen.getByRole("button", { name: "Retry" }));
		expect(await screen.findByText("root.txt")).toBeTruthy();
		expect(screen.queryByRole("alert")).toBeNull();
	});

	test("preserves the parsed top-level error for a managed source", async () => {
		server.use(
			http.get("/api/v1/volumes/source-1/files", () =>
				HttpResponse.json({ message: "Managed source is unavailable" }, { status: 503 }),
			),
		);

		render(<VolumeFileBrowser volumeId="source-1" />);

		expect((await screen.findByRole("alert")).textContent).toContain("Managed source is unavailable");
	});
});
