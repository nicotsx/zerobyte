import { afterEach, describe, expect, test, vi } from "vitest";
import { listSourceMachinesOptions } from "~/client/api-client/@tanstack/react-query.gen";
import type { GetVolumeResponse, ListSourceMachinesResponse, UpdateVolumeData } from "~/client/api-client/types.gen";
import { HttpResponse, http, server } from "~/test/msw/server";
import { cleanup, render, screen, userEvent, waitFor } from "~/test/test-utils";

const testState = vi.hoisted(() => ({
	remoteAgents: true,
	runtime: "server" as "server" | "desktop" | "unknown",
	isSystemInfoLoading: false,
	isSystemInfoSuccess: true,
	systemInfoError: null as Error | null,
	navigate: vi.fn(async () => {}),
}));

vi.mock("@tanstack/react-router", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@tanstack/react-router")>();
	return { ...actual, useNavigate: (() => testState.navigate) as typeof actual.useNavigate };
});

vi.mock("~/client/hooks/use-system-info", () => ({
	useSystemInfo: () => ({
		runtime: testState.runtime,
		capabilities: {
			rclone: true,
			sysAdmin: true,
			volumeBackends: ["directory", "nfs", "smb", "webdav", "sftp", "rclone"],
			repositoryBackends: [],
		},
		isLoading: testState.isSystemInfoLoading,
		isSuccess: testState.isSystemInfoSuccess,
		error: testState.systemInfoError,
		refetch: vi.fn(),
	}),
}));

vi.mock("~/client/hooks/use-permissions", () => ({
	usePermissions: () => ({
		can: () => false,
		hasRuntimeFeature: (feature: string) => feature === "remoteAgents" && testState.remoteAgents,
	}),
}));

import { EditVolumePage } from "../edit-volume";

const volumeBase = {
	id: 1,
	shortId: "source-1",
	name: "Archive",
	createdAt: 1,
	updatedAt: 1,
	lastHealthCheck: 1,
	status: "unmounted" as const,
	lastError: null,
	provisioningId: null,
	autoRemount: true,
};

type VolumeDetail = GetVolumeResponse["volume"];
type RemoteVolume = Extract<VolumeDetail, { sourceKind: "agent-filesystem" }>;
type RemoteAvailability = RemoteVolume["sourceLocation"]["availability"];
type UpdateVolumeBody = UpdateVolumeData["body"];
type SourceMachine = ListSourceMachinesResponse[number];

const remoteVolume = (availability: RemoteAvailability): RemoteVolume => {
	const machineName = availability === "missing-agent" ? "Unavailable machine" : "Archive node";
	const machineStatus = availability === "available" ? "online" : "offline";
	const revokedAt = availability === "revoked" ? 1 : null;
	const rootLabel = availability === "root-removed" ? "Unavailable location" : "Family photos";
	const canBackup = availability === "available";
	const volume = {
		...volumeBase,
		config: null,
		type: null,
		agentId: "archive-node",
		sourceKind: "agent-filesystem",
		trustedRootId: "photos",
		relativePath: "family",
		sourceLocation: {
			machine: {
				id: "archive-node",
				name: machineName,
				status: machineStatus,
				lastSeenAt: 1,
				revokedAt,
			},
			root: { id: "photos", label: rootLabel, canBackup },
			relativePath: "family",
			availability,
		},
		path: "/",
	} satisfies RemoteVolume;
	return volume;
};

const managedVolume = {
	...volumeBase,
	config: { backend: "directory" as const, path: "/srv/archive", readOnly: false as const },
	type: "directory" as const,
	agentId: "local",
	sourceKind: "managed" as const,
	trustedRootId: null,
	relativePath: null,
	sourceLocation: null,
	path: "/srv/archive",
} satisfies VolumeDetail;

const detail = (volume: VolumeDetail): GetVolumeResponse => ({
	volume,
	statfs: { total: 0, used: 0, free: 0 },
});

const healthyAlternate = {
	id: "studio-node",
	name: "Studio node",
	status: "online",
	availability: "available",
	lastSeenAt: 1,
	revokedAt: null,
	trustedRoots: [{ id: "projects", label: "Projects", canBackup: true }],
} satisfies SourceMachine;

const recoveredCurrentMachine = {
	id: "archive-node",
	name: "Archive node",
	status: "online",
	availability: "available",
	lastSeenAt: 2,
	revokedAt: null,
	trustedRoots: [{ id: "photos", label: "Family photos", canBackup: true }],
} satisfies SourceMachine;

const unavailableAvailabilities = [
	"offline",
	"revoked",
	"missing-agent",
	"root-removed",
	"backup-disabled",
] satisfies readonly RemoteAvailability[];

afterEach(() => {
	testState.remoteAgents = true;
	testState.runtime = "server";
	testState.isSystemInfoLoading = false;
	testState.isSystemInfoSuccess = true;
	testState.systemInfoError = null;
	testState.navigate.mockClear();
	cleanup();
});

describe("EditVolumePage source forms", () => {
	test.each(unavailableAvailabilities)(
		"submits only the name for a remote %s Source and preserves its saved location",
		async (availability) => {
			let submittedBody: UpdateVolumeBody | undefined;
			const volume = remoteVolume(availability);
			server.use(
				http.get("/api/v1/volumes/source-1", () => HttpResponse.json(detail(volume))),
				http.get("/api/v1/volumes/source-machines", () => HttpResponse.json([healthyAlternate])),
				http.put("/api/v1/volumes/source-1", async ({ request }) => {
					submittedBody = (await request.json()) as UpdateVolumeBody;
					return HttpResponse.json({ ...volume, name: submittedBody.name });
				}),
			);

			render(<EditVolumePage volumeId="source-1" />, { withSuspense: true });
			const nameInput = await screen.findByLabelText("Source name");
			await userEvent.clear(nameInput);
			await userEvent.type(nameInput, "Renamed archive");
			await userEvent.click(screen.getByRole("button", { name: "Save changes" }));

			await waitFor(() => expect(submittedBody).toEqual({ name: "Renamed archive" }));
			expect(screen.queryByText("Backend")).toBeNull();
			expect(screen.queryByText(/remount it/)).toBeNull();
			expect(screen.getByRole("button", { name: "Change location" }).hasAttribute("disabled")).toBe(false);
		},
	);

	test("starts location changes with an empty selection even when the saved machine has recovered", async () => {
		server.use(
			http.get("/api/v1/volumes/source-1", () => HttpResponse.json(detail(remoteVolume("offline")))),
			http.get("/api/v1/volumes/source-machines", () =>
				HttpResponse.json([recoveredCurrentMachine, healthyAlternate]),
			),
		);
		render(<EditVolumePage volumeId="source-1" />, { withSuspense: true });
		await userEvent.click(await screen.findByRole("button", { name: "Change location" }));
		expect((await screen.findByLabelText("Remote machine")).textContent).toBe("Choose a machine");
		await userEvent.click(screen.getByRole("button", { name: "Save changes" }));
		expect(screen.getByText("Choose an available machine and select a folder before saving.")).toBeTruthy();
		await userEvent.click(screen.getByRole("button", { name: "Keep current location" }));
		expect(screen.queryByLabelText("Remote machine")).toBeNull();
	});

	test("requires a fresh explicit remote location and submits no managed fields", async () => {
		let submittedBody: UpdateVolumeBody | undefined;
		const volume = remoteVolume("offline");
		const machine = healthyAlternate;
		server.use(
			http.get("/api/v1/volumes/source-1", () => HttpResponse.json(detail(volume))),
			http.get("/api/v1/volumes/source-machines", () => HttpResponse.json([machine])),
			http.get("/api/v1/volumes/filesystem/browse", () =>
				HttpResponse.json({ directories: [], path: "trusted-root:" }),
			),
			http.put("/api/v1/volumes/source-1", async ({ request }) => {
				submittedBody = (await request.json()) as UpdateVolumeBody;
				return HttpResponse.json(volume);
			}),
		);

		render(<EditVolumePage volumeId="source-1" />, { withSuspense: true });
		const locationToggle = await screen.findByRole("button", { name: "Change location" });
		await userEvent.click(locationToggle);
		expect(document.activeElement).toBe(locationToggle);
		expect(locationToggle.textContent).toBe("Keep current location");
		await userEvent.click(locationToggle);
		expect(document.activeElement).toBe(locationToggle);
		expect(locationToggle.textContent).toBe("Change location");
		await userEvent.click(locationToggle);
		expect(document.activeElement).toBe(locationToggle);
		await userEvent.click(await screen.findByLabelText("Remote machine"));
		await userEvent.click(screen.getByRole("option", { name: "Studio node · available" }));
		await userEvent.click(await screen.findByLabelText("Allowed location"));
		await userEvent.click(screen.getByRole("option", { name: "Projects" }));
		await userEvent.click(screen.getByRole("button", { name: "Change" }));
		await userEvent.click(await screen.findByRole("button", { name: "Select entire location" }));
		await userEvent.click(screen.getByRole("button", { name: "Save changes" }));

		await waitFor(() => expect(submittedBody).toBeDefined());
		expect(submittedBody).toEqual({
			name: "Archive",
			sourceKind: "agent-filesystem",
			agentId: "studio-node",
			trustedRootId: "projects",
			relativePath: "",
		});
		expect(submittedBody).not.toHaveProperty("config");
		expect(submittedBody).not.toHaveProperty("autoRemount");
		expect(screen.queryByText(/remount it/)).toBeNull();
	});

	test("discovers remote sources when system info is unavailable", async () => {
		let sourceMachineRequests = 0;
		testState.isSystemInfoSuccess = false;
		testState.systemInfoError = new Error("System info unavailable");
		server.use(
			http.get("/api/v1/volumes/source-1", () => HttpResponse.json(detail(remoteVolume("available")))),
			http.get("/api/v1/volumes/source-machines", () => {
				sourceMachineRequests += 1;
				return HttpResponse.json([healthyAlternate]);
			}),
		);

		render(<EditVolumePage volumeId="source-1" />, { withSuspense: true });
		await userEvent.click(await screen.findByRole("button", { name: "Change location" }));
		expect(await screen.findByLabelText("Remote machine")).toBeTruthy();
		expect(sourceMachineRequests).toBe(1);
	});

	test("does not offer source discovery when remote agents are unsupported", async () => {
		let sourceMachineRequests = 0;
		testState.remoteAgents = false;
		server.use(
			http.get("/api/v1/volumes/source-1", () => HttpResponse.json(detail(remoteVolume("available")))),
			http.get("/api/v1/volumes/source-machines", () => {
				sourceMachineRequests += 1;
				return HttpResponse.json([]);
			}),
		);

		render(<EditVolumePage volumeId="source-1" />, { withSuspense: true });
		await userEvent.click(await screen.findByRole("button", { name: "Change location" }));
		expect(await screen.findByText("Remote source discovery is unavailable in this runtime.")).toBeTruthy();
		expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
		expect(sourceMachineRequests).toBe(0);
	});

	test("clears the chosen location when a source-machine refetch reports it offline", async () => {
		let sourceMachineRequests = 0;
		const currentMachine = {
			id: "archive-node",
			name: "Archive node",
			status: "online" as "online" | "offline",
			lastSeenAt: 1,
			revokedAt: null,
			trustedRoots: [{ id: "photos", label: "Family photos", canBackup: true }],
		};
		server.use(
			http.get("/api/v1/volumes/source-1", () => HttpResponse.json(detail(remoteVolume("available")))),
			http.get("/api/v1/volumes/source-machines", () => {
				sourceMachineRequests += 1;
				const status = sourceMachineRequests === 1 ? "online" : "offline";
				const availability = status === "online" ? "available" : "offline";
				return HttpResponse.json([{ ...currentMachine, status, availability }]);
			}),
			http.get("/api/v1/volumes/filesystem/browse", () =>
				HttpResponse.json({ directories: [], path: "trusted-root:" }),
			),
		);

		const view = render(<EditVolumePage volumeId="source-1" />, { withSuspense: true });
		await userEvent.click(await screen.findByRole("button", { name: "Change location" }));
		await userEvent.click(await screen.findByLabelText("Remote machine"));
		await userEvent.click(screen.getByRole("option", { name: "Archive node · available" }));
		await userEvent.click(await screen.findByLabelText("Allowed location"));
		await userEvent.click(screen.getByRole("option", { name: "Family photos" }));
		await userEvent.click(screen.getByRole("button", { name: "Change" }));
		await userEvent.click(await screen.findByRole("button", { name: "Select entire location" }));
		expect(screen.getByRole("button", { name: "Save changes" }).hasAttribute("disabled")).toBe(false);

		const sourceMachinesQueryKey = listSourceMachinesOptions().queryKey;
		await view.queryClient.refetchQueries({ queryKey: sourceMachinesQueryKey });

		await waitFor(() =>
			expect((screen.getByLabelText("Allowed location") as HTMLSelectElement).disabled).toBe(true),
		);
		expect(screen.queryByLabelText("Browse Family photos")).toBeNull();
		await userEvent.click(screen.getByRole("button", { name: "Save changes" }));
		expect(screen.getByText("Choose an available machine and select a folder before saving.")).toBeTruthy();
	});

	test("disables an open location change when cached discovery refetch fails and does not restore its path", async () => {
		let discoveryShouldFail = false;
		const currentMachine = {
			id: "archive-node",
			name: "Archive node",
			status: "online" as const,
			availability: "available" as const,
			lastSeenAt: 1,
			revokedAt: null,
			trustedRoots: [{ id: "photos", label: "Family photos", canBackup: true }],
		};
		server.use(
			http.get("/api/v1/volumes/source-1", () => HttpResponse.json(detail(remoteVolume("available")))),
			http.get("/api/v1/volumes/source-machines", () => {
				if (discoveryShouldFail) {
					return HttpResponse.json({ message: "/srv/private could not be probed" }, { status: 503 });
				}
				return HttpResponse.json([currentMachine]);
			}),
			http.get("/api/v1/volumes/filesystem/browse", () =>
				HttpResponse.json({ directories: [], path: "trusted-root:" }),
			),
		);

		const view = render(<EditVolumePage volumeId="source-1" />, { withSuspense: true });
		await userEvent.click(await screen.findByRole("button", { name: "Change location" }));
		await userEvent.click(await screen.findByLabelText("Remote machine"));
		await userEvent.click(screen.getByRole("option", { name: "Archive node · available" }));
		await userEvent.click(await screen.findByLabelText("Allowed location"));
		await userEvent.click(screen.getByRole("option", { name: "Family photos" }));
		await userEvent.click(screen.getByRole("button", { name: "Change" }));
		await userEvent.click(await screen.findByRole("button", { name: "Select entire location" }));
		const submitButton = screen.getByRole("button", { name: "Save changes" });
		expect(submitButton.hasAttribute("disabled")).toBe(false);

		discoveryShouldFail = true;
		const sourceMachinesQuery = listSourceMachinesOptions();
		await view.queryClient.refetchQueries({ queryKey: sourceMachinesQuery.queryKey });

		expect(await screen.findByText("Available machines could not be loaded.")).toBeTruthy();
		expect(view.queryClient.getQueryData(sourceMachinesQuery.queryKey)).toEqual([currentMachine]);
		expect(screen.queryByRole("button", { name: "Select entire location" })).toBeNull();
		await userEvent.click(submitButton);
		expect(screen.getByText("Choose an available machine and select a folder before saving.")).toBeTruthy();
		expect(screen.queryByText("/srv/private could not be probed")).toBeNull();

		discoveryShouldFail = false;
		server.use(http.get("/api/v1/volumes/source-machines", () => HttpResponse.json([currentMachine])));
		await userEvent.click(screen.getByRole("button", { name: "Retry" }));
		await screen.findByLabelText("Remote machine");
		expect(screen.queryByText(/^Selected:/)).toBeNull();
		await userEvent.click(submitButton);
		expect(screen.getByText("Choose an available machine and select a folder before saving.")).toBeTruthy();

		await userEvent.click(await screen.findByLabelText("Remote machine"));
		await userEvent.click(screen.getByRole("option", { name: "Archive node · available" }));
		await userEvent.click(await screen.findByLabelText("Allowed location"));
		await userEvent.click(screen.getByRole("option", { name: "Family photos" }));
		await userEvent.click(screen.getByRole("button", { name: "Change" }));
		await userEvent.click(await screen.findByRole("button", { name: "Select entire location" }));
		expect(submitButton.hasAttribute("disabled")).toBe(false);
	});

	test("keeps the managed edit form and remount confirmation without querying source machines", async () => {
		let sourceMachineRequests = 0;
		server.use(
			http.get("/api/v1/volumes/source-1", () => HttpResponse.json(detail(managedVolume))),
			http.get("/api/v1/volumes/source-machines", () => {
				sourceMachineRequests += 1;
				return HttpResponse.json([]);
			}),
		);

		render(<EditVolumePage volumeId="source-1" />, { withSuspense: true });
		expect(await screen.findByText("Backend")).toBeTruthy();
		await userEvent.click(screen.getByRole("button", { name: "Save changes" }));
		expect(await screen.findByText("Update Source Configuration")).toBeTruthy();
		expect(screen.getByText(/remount it with the new config immediately/)).toBeTruthy();
		expect(sourceMachineRequests).toBe(0);
	});
});
