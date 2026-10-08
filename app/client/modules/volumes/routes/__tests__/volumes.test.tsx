import { fromPartial } from "@total-typescript/shoehorn";
import { afterEach, expect, test, vi } from "vitest";
import type { ListVolumesResponse } from "~/client/api-client/types.gen";
import { HttpResponse, http, server } from "~/test/msw/server";
import { cleanup, render, screen, userEvent } from "~/test/test-utils";
import { VolumesPage } from "../volumes";

vi.mock("@tanstack/react-router", async (importOriginal) => ({
	...(await importOriginal<typeof import("@tanstack/react-router")>()),
	useNavigate: () => vi.fn(),
}));

afterEach(cleanup);

test("the Error filter includes failed managed and filesystem sources", async () => {
	const sources = [
		fromPartial<ListVolumesResponse[number]>({
			shortId: "managed",
			name: "Failed share",
			sourceKind: "managed",
			type: "nfs",
			status: "error",
			sourceLocation: null,
		}),
		fromPartial<ListVolumesResponse[number]>({
			shortId: "remote",
			name: "Failed archive",
			sourceKind: "filesystem",
			type: null,
			status: "error",
			sourceLocation: { machine: "Archive NAS", location: "Photos", path: "Photos/family" },
		}),
		fromPartial<ListVolumesResponse[number]>({
			shortId: "healthy",
			name: "Healthy folder",
			sourceKind: "managed",
			type: "directory",
			status: "mounted",
			sourceLocation: null,
		}),
	];
	server.use(http.get("/api/v1/volumes", () => HttpResponse.json(sources)));
	render(<VolumesPage />, { withSuspense: true });

	expect(await screen.findByText("Archive NAS")).toBeTruthy();
	await userEvent.click(screen.getAllByRole("combobox")[0]);
	await userEvent.click(screen.getByRole("option", { name: "Error" }));

	expect(screen.getByText("Failed share")).toBeTruthy();
	expect(screen.getByText("Failed archive")).toBeTruthy();
	expect(screen.queryByText("Healthy folder")).toBeNull();
});
