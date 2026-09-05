import { fromPartial } from "@total-typescript/shoehorn";
import { afterEach, expect, test, vi } from "vitest";
import type { GetVolumeResponse } from "~/client/api-client/types.gen";
import { HttpResponse, http, server } from "~/test/msw/server";
import { cleanup, render, screen, userEvent } from "~/test/test-utils";
import { VolumeDetails } from "../volume-details";

vi.mock("@tanstack/react-router", () => ({
	useNavigate: () => vi.fn(),
	useSearch: () => ({ tab: "files" }),
}));

afterEach(cleanup);

test("Check Now makes a previously unmounted folder browsable", async () => {
	let volume = fromPartial<GetVolumeResponse["volume"]>({
		shortId: "folder-1",
		name: "Existing folder",
		type: "directory",
		config: { backend: "directory", path: "/data" },
		status: "unmounted",
		autoRemount: false,
		createdAt: 0,
		lastHealthCheck: 0,
	});

	server.use(
		http.get("/api/v1/volumes/folder-1", () => HttpResponse.json({ volume, statfs: {} })),
		http.post("/api/v1/volumes/folder-1/health-check", () => {
			volume = { ...volume, status: "mounted", lastError: null };
			return HttpResponse.json({ status: "mounted" });
		}),
		http.get("/api/v1/volumes/folder-1/files", () =>
			HttpResponse.json({ files: [], path: "/", offset: 0, limit: 500, total: 0, hasMore: false }),
		),
	);

	render(<VolumeDetails volumeId="folder-1" />, { withSuspense: true });
	expect(await screen.findByText("Directory is not accessible.")).toBeTruthy();
	const checkNow = screen.getByRole<HTMLButtonElement>("button", { name: "Check Now" });
	expect(checkNow.disabled).toBe(false);
	await userEvent.click(checkNow);
	expect(await screen.findByText("This volume is empty.")).toBeTruthy();
	expect(screen.queryByText("Directory is not accessible.")).toBeNull();
});
