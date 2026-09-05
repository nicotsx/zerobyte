import { cleanup, render, screen, userEvent, waitFor } from "~/test/test-utils";
import { HttpResponse, http, server } from "~/test/msw/server";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { GetVolumeResponse, ListVolumesResponse } from "~/client/api-client/types.gen";

const routerState = vi.hoisted(() => ({
	navigate: vi.fn(async () => {}),
	tab: "info",
}));

vi.mock("@tanstack/react-router", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@tanstack/react-router")>();
	return {
		...actual,
		useNavigate: (() => routerState.navigate) as typeof actual.useNavigate,
		useSearch: (() => ({ tab: routerState.tab })) as typeof actual.useSearch,
	};
});

import { VolumeDetails } from "../volume-details";
import { VolumesPage } from "../volumes";

const volumeBase = {
	id: 1,
	shortId: "source-1",
	name: "Archive",
	createdAt: 1,
	updatedAt: 1,
	lastHealthCheck: 1,
	lastError: null,
	provisioningId: null,
	autoRemount: true,
};

type ListedVolume = ListVolumesResponse[number];
type VolumeDetail = GetVolumeResponse["volume"];

const managedVolume = {
	...volumeBase,
	config: { backend: "directory" as const, path: "/srv/archive", readOnly: false as const },
	type: "directory" as const,
	status: "unmounted" as const,
	agentId: "local",
	sourceKind: "managed" as const,
	trustedRootId: null,
	relativePath: null,
	sourceLocation: null,
} satisfies ListedVolume;

const managedVolumeDetail = {
	...managedVolume,
	path: "/srv/archive",
} satisfies VolumeDetail;

const remoteVolume = {
	...volumeBase,
	id: 2,
	shortId: "source-2",
	name: "Design files",
	config: null,
	type: null,
	status: "mounted" as const,
	agentId: "studio-id",
	sourceKind: "agent-filesystem" as const,
	trustedRootId: "work-id",
	relativePath: "client/launch",
	sourceLocation: {
		machine: {
			id: "studio-id",
			name: "Studio Mac",
			status: "online" as const,
			lastSeenAt: 1,
			revokedAt: null,
		},
		root: { id: "work-id", label: "Work files", canBackup: true },
		relativePath: "client/launch",
		availability: "available",
	},
} satisfies ListedVolume;

const remoteVolumeDetail = {
	...remoteVolume,
	path: "/",
} satisfies VolumeDetail;

const detail = (volume: VolumeDetail): GetVolumeResponse => ({
	volume,
	statfs: { total: 0, used: 0, free: 0 },
});

afterEach(() => {
	routerState.navigate.mockClear();
	routerState.tab = "info";
	cleanup();
});

describe("source list", () => {
	test("keeps managed rows dense while remote rows show safe context and effective availability", async () => {
		server.use(http.get("/api/v1/volumes", () => HttpResponse.json([managedVolume, remoteVolume])));

		render(<VolumesPage />, { withSuspense: true });

		expect(await screen.findByText("Archive")).toBeTruthy();
		expect(screen.getByLabelText("unmounted")).toBeTruthy();
		expect(screen.getByText("Directory")).toBeTruthy();
		expect(screen.getByText("Design files")).toBeTruthy();
		expect(screen.getByText("Studio Mac · Work files/client/launch")).toBeTruthy();
		expect(screen.getByLabelText("Available")).toBeTruthy();
		expect(screen.getByText("Remote files")).toBeTruthy();
		expect(screen.queryByText("studio-id")).toBeNull();
		expect(screen.queryByText("work-id")).toBeNull();
	});

	test.each([
		["Remote files", "Design files", "Archive"],
		["Directory", "Archive", "Design files"],
	] as const)("filters the mixed list by the visible %s backend", async (backend, visibleName, hiddenName) => {
		server.use(http.get("/api/v1/volumes", () => HttpResponse.json([managedVolume, remoteVolume])));

		render(<VolumesPage />, { withSuspense: true });

		expect(await screen.findByText("Archive")).toBeTruthy();
		const backendFilter = screen.getAllByRole("combobox")[1];
		await userEvent.click(backendFilter);
		await userEvent.click(screen.getByRole("option", { name: backend }));

		expect(screen.getByText(visibleName)).toBeTruthy();
		expect(screen.queryByText(hiddenName)).toBeNull();
	});

	test("sorts the mixed list by the backend values shown to the user", async () => {
		server.use(http.get("/api/v1/volumes", () => HttpResponse.json([remoteVolume, managedVolume])));

		render(<VolumesPage />, { withSuspense: true });

		expect(await screen.findByText("Archive")).toBeTruthy();
		await userEvent.click(screen.getByRole("button", { name: /Backend/ }));
		const dataRows = screen
			.getAllByRole("row")
			.filter((row) => row.textContent?.includes("Archive") || row.textContent?.includes("Design files"));

		expect(dataRows[0]?.textContent).toContain("Archive");
		expect(dataRows[0]?.textContent).toContain("Directory");
		expect(dataRows[1]?.textContent).toContain("Design files");
		expect(dataRows[1]?.textContent).toContain("Remote files");
	});

	test("uses Source terminology while preserving the volumes route", async () => {
		server.use(http.get("/api/v1/volumes", () => HttpResponse.json([])));

		render(<VolumesPage />, { withSuspense: true });
		await screen.findByText("No sources");
		const createButton = screen.getByRole("button", { name: "Create Source" });
		createButton.click();

		expect(routerState.navigate).toHaveBeenCalledWith({ to: "/volumes/create" });
	});
});

describe("source detail", () => {
	test.each([
		["available", "bg-success"],
		["offline", "bg-gray-500"],
		["degraded", "bg-yellow-500"],
		["revoked", "bg-red-500"],
	] as const)("uses the canonical %s status-dot styling everywhere", async (availability, expectedClass) => {
		const sourceLocation = { ...remoteVolumeDetail.sourceLocation, availability };
		const listedVolume = { ...remoteVolume, sourceLocation } satisfies ListedVolume;
		const volume = {
			...remoteVolumeDetail,
			sourceLocation,
		} satisfies VolumeDetail;
		server.use(
			http.get("/api/v1/volumes", () => HttpResponse.json([listedVolume])),
			http.get("/api/v1/volumes/source-2", () => HttpResponse.json(detail(volume))),
		);

		render(
			<>
				<VolumesPage />
				<VolumeDetails volumeId="source-2" />
			</>,
			{ withSuspense: true },
		);

		const expectedLabel =
			availability === "available" ? "Available" : availability === "offline" ? "Unavailable" : "Needs attention";
		const statusDots = await screen.findAllByLabelText(expectedLabel);
		const dotClasses = statusDots.map((statusDot) => statusDot.lastElementChild?.className);

		expect(statusDots.length).toBeGreaterThanOrEqual(3);
		expect(dotClasses.every((className) => className?.includes(expectedClass))).toBe(true);
		expect(screen.getAllByText(expectedLabel).length).toBeGreaterThanOrEqual(2);
	});

	test("preserves managed directory health, backend, and configuration controls", async () => {
		server.use(http.get("/api/v1/volumes/source-1", () => HttpResponse.json(detail(managedVolumeDetail))));

		render(<VolumeDetails volumeId="source-1" />, { withSuspense: true });

		expect(await screen.findByText("Unmounted")).toBeTruthy();
		expect(screen.queryByRole("button", { name: "Mount" })).toBeNull();
		expect(screen.queryByText("Auto-remount")).toBeNull();
		expect(screen.getByRole("button", { name: "Check Now" })).toBeTruthy();
		expect(screen.getByText("directory")).toBeTruthy();
		expect(screen.getByText("/srv/archive")).toBeTruthy();
	});

	test("uses availability semantics and hides mount-only concepts for remote sources", async () => {
		const remoteWithPrivateError = {
			...remoteVolumeDetail,
			lastError: "/Users/nicolas/private/root failed",
		} satisfies VolumeDetail;
		server.use(http.get("/api/v1/volumes/source-2", () => HttpResponse.json(detail(remoteWithPrivateError))));

		render(<VolumeDetails volumeId="source-2" />, { withSuspense: true });

		expect(await screen.findByText("Studio Mac · Work files/client/launch")).toBeTruthy();
		expect(screen.getAllByText("Available").length).toBeGreaterThan(0);
		expect(screen.getByRole("button", { name: "Check availability" })).toBeTruthy();
		expect(screen.getByRole("tab", { name: "Information" })).toBeTruthy();
		expect(screen.getByText("Machine")).toBeTruthy();
		expect(screen.getByText("Allowed location")).toBeTruthy();
		expect(screen.queryByRole("button", { name: "Mount" })).toBeNull();
		expect(screen.queryByRole("button", { name: "Unmount" })).toBeNull();
		expect(screen.queryByText("Auto-remount")).toBeNull();
		expect(screen.queryByText("Agent filesystem")).toBeNull();
		expect(screen.queryByText("studio-id")).toBeNull();
		expect(screen.queryByText("work-id")).toBeNull();
		expect(screen.queryByText(/Users\/nicolas/)).toBeNull();
	});

	test("updates availability and blocks files after a failed explicit check", async () => {
		let checkStatus: "initial" | "failed" | "recovered" = "initial";
		const failedAt = Date.now();
		const recoveredAt = failedAt + 1;
		routerState.tab = "files";
		server.use(
			http.get("/api/v1/volumes/source-2", () => {
				let checkedVolume: VolumeDetail = remoteVolumeDetail;
				if (checkStatus === "failed") {
					checkedVolume = {
						...remoteVolumeDetail,
						status: "error",
						lastHealthCheck: failedAt,
						lastError: "/private/statfs failed",
					};
				} else if (checkStatus === "recovered") {
					checkedVolume = { ...remoteVolumeDetail, lastHealthCheck: recoveredAt };
				}
				return HttpResponse.json(detail(checkedVolume));
			}),
			http.get("/api/v1/volumes/source-2/files", () =>
				HttpResponse.json({ files: [], offset: 0, limit: 100, total: 0, hasMore: false }),
			),
			http.post("/api/v1/volumes/source-2/health-check", () => {
				if (checkStatus === "initial") {
					checkStatus = "failed";
					return HttpResponse.json({ status: "error", error: "/private/statfs failed" });
				}
				checkStatus = "recovered";
				return HttpResponse.json({ status: "mounted" });
			}),
		);

		render(<VolumeDetails volumeId="source-2" />, { withSuspense: true });

		expect(await screen.findByText("File Explorer")).toBeTruthy();
		await userEvent.click(screen.getByRole("button", { name: "Check availability" }));

		await waitFor(() => expect(screen.getAllByText("Needs attention").length).toBeGreaterThan(0));
		expect(screen.getByRole("status").textContent).toContain("most recent availability check");
		expect(screen.queryByText("File Explorer")).toBeNull();
		expect(document.body.textContent).not.toContain("/private/statfs");

		await userEvent.click(screen.getByRole("button", { name: "Check availability" }));

		await waitFor(() => expect(screen.getAllByText("Available").length).toBeGreaterThan(0));
		expect(await screen.findByText("File Explorer")).toBeTruthy();
	});
});
