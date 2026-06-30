import { afterEach, describe, expect, test } from "vitest";
import { HttpResponse, http, server } from "~/test/msw/server";
import { cleanup, render, waitFor } from "~/test/test-utils";
import { LocalFileBrowser } from "../local-file-browser";

afterEach(() => {
	cleanup();
});

describe("LocalFileBrowser", () => {
	test("keeps Windows drive roots as host paths", async () => {
		const requests: string[] = [];

		server.use(
			http.get("/api/v1/volumes/filesystem/browse", ({ request }) => {
				const url = new URL(request.url);
				requests.push(url.searchParams.get("path") ?? "");

				return HttpResponse.json({
					directories: [],
					path: "C:\\",
				});
			}),
		);

		render(<LocalFileBrowser initialPath={"C:\\"} />);

		await waitFor(() => {
			expect(requests).toEqual(["C:\\"]);
		});
	});

	test("uses the trimmed initial path for the first browse request", async () => {
		const requests: string[] = [];

		server.use(
			http.get("/api/v1/volumes/filesystem/browse", ({ request }) => {
				const url = new URL(request.url);
				requests.push(url.searchParams.get("path") ?? "");

				return HttpResponse.json({
					directories: [],
					path: "/tmp",
				});
			}),
		);

		render(<LocalFileBrowser initialPath={"  /tmp  "} />);

		await waitFor(() => {
			expect(requests).toEqual(["/tmp"]);
		});
	});
});
