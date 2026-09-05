import { afterEach, describe, expect, test, vi } from "vitest";
import { listSourceMachinesOptions } from "~/client/api-client/@tanstack/react-query.gen";
import type { CreateVolumeData, ListSourceMachinesResponse } from "~/client/api-client/types.gen";
import { HttpResponse, http, server } from "~/test/msw/server";
import { cleanup, render, screen, userEvent, waitFor } from "~/test/test-utils";

const testState = vi.hoisted(() => ({
	remoteAgents: true,
	runtime: "server" as "server" | "desktop",
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

import { CreateVolumePage } from "../create-volume";

type CreateVolumeBody = CreateVolumeData["body"];

const remoteMachine = {
	id: "archive-node",
	name: "Archive node",
	status: "online" as const,
	availability: "available" as const,
	lastSeenAt: 1,
	revokedAt: null,
	trustedRoots: [{ id: "photos", label: "Family photos", canBackup: true }],
} satisfies ListSourceMachinesResponse[number];

afterEach(() => {
	testState.remoteAgents = true;
	testState.runtime = "server";
	testState.isSystemInfoLoading = false;
	testState.isSystemInfoSuccess = true;
	testState.systemInfoError = null;
	testState.navigate.mockClear();
	cleanup();
});

describe("CreateVolumePage source selection", () => {
	test("keeps the existing local form and avoids source discovery on unsupported desktop runtime", async () => {
		let discoveryRequests = 0;
		testState.remoteAgents = false;
		testState.runtime = "desktop";
		server.use(
			http.get("/api/v1/volumes/source-machines", () => {
				discoveryRequests += 1;
				return HttpResponse.json([remoteMachine]);
			}),
		);

		render(<CreateVolumePage />);
		expect(screen.getByLabelText("Name")).toBeTruthy();
		expect(screen.getByText("Backend")).toBeTruthy();
		expect(screen.queryByText("Another machine")).toBeNull();
		expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
		await new Promise((resolve) => setTimeout(resolve, 20));
		expect(discoveryRequests).toBe(0);
	});

	test("discovers remote sources when system info is unavailable", async () => {
		let discoveryRequests = 0;
		testState.isSystemInfoSuccess = false;
		testState.systemInfoError = new Error("System info unavailable");
		server.use(
			http.get("/api/v1/volumes/source-machines", () => {
				discoveryRequests += 1;
				return HttpResponse.json([remoteMachine]);
			}),
		);

		render(<CreateVolumePage />);
		await waitFor(() => expect(discoveryRequests).toBe(1));
		expect(await screen.findByLabelText("Another machine")).toBeTruthy();
		expect(screen.getByText("Backend")).toBeTruthy();
		expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
	});

	test("does not add remote controls when discovery returns no remote machines", async () => {
		let discoveryRequests = 0;
		server.use(
			http.get("/api/v1/volumes/source-machines", () => {
				discoveryRequests += 1;
				return HttpResponse.json([]);
			}),
		);

		render(<CreateVolumePage />);
		await waitFor(() => expect(discoveryRequests).toBe(1));
		expect(screen.queryByText("Another machine")).toBeNull();
		expect(screen.getByText("Backend")).toBeTruthy();
	});

	test("keeps This server as the default and exposes every managed backend", async () => {
		server.use(http.get("/api/v1/volumes/source-machines", () => HttpResponse.json([remoteMachine])));
		render(<CreateVolumePage />);

		const localChoice = await screen.findByLabelText("This server");
		expect((localChoice as HTMLInputElement).checked).toBe(true);
		expect(screen.getByText("Backend")).toBeTruthy();
		await userEvent.click(screen.getByRole("combobox"));
		for (const backend of ["Directory", "NFS", "SMB", "WebDAV", "SFTP", "rclone"]) {
			expect(await screen.findByRole("option", { name: backend })).toBeTruthy();
		}
	});

	test("submits the unchanged managed directory payload", async () => {
		let submittedBody: CreateVolumeBody | undefined;
		server.use(
			http.get("/api/v1/volumes/source-machines", () => HttpResponse.json([])),
			http.get("/api/v1/volumes/filesystem/browse", () =>
				HttpResponse.json({
					directories: [{ name: "archive", path: "/archive", type: "directory" }],
					path: "/",
				}),
			),
			http.post("/api/v1/volumes", async ({ request }) => {
				submittedBody = (await request.json()) as CreateVolumeBody;
				return HttpResponse.json({ shortId: "managed-source" }, { status: 201 });
			}),
		);

		render(<CreateVolumePage />);
		await userEvent.type(screen.getByLabelText("Name"), "Local archive");
		await userEvent.click(screen.getByRole("button", { name: "Change" }));
		await userEvent.click(await screen.findByRole("button", { name: "archive" }));
		await userEvent.click(screen.getByRole("button", { name: "Create Source" }));

		await waitFor(() => expect(submittedBody).toBeDefined());
		expect(submittedBody).toEqual({
			name: "Local archive",
			config: { backend: "directory", path: "/archive" },
		});
	});

	test("submits the exact remote source body without managed config or credentials", async () => {
		let submittedBody: CreateVolumeBody | undefined;
		server.use(
			http.get("/api/v1/volumes/source-machines", () => HttpResponse.json([remoteMachine])),
			http.get("/api/v1/volumes/filesystem/browse", () =>
				HttpResponse.json({ directories: [], path: "trusted-root:" }),
			),
			http.post("/api/v1/volumes", async ({ request }) => {
				submittedBody = (await request.json()) as CreateVolumeBody;
				return HttpResponse.json({ shortId: "created-source" }, { status: 201 });
			}),
		);

		render(<CreateVolumePage />);
		await userEvent.click(await screen.findByLabelText("Another machine"));
		await userEvent.type(screen.getByLabelText("Source name"), "Remote archive");
		await userEvent.click(await screen.findByLabelText("Remote machine"));
		await userEvent.click(screen.getByRole("option", { name: "Archive node · available" }));
		await userEvent.click(await screen.findByLabelText("Allowed location"));
		await userEvent.click(screen.getByRole("option", { name: "Family photos" }));
		await userEvent.click(screen.getByRole("button", { name: "Change" }));
		await userEvent.click(await screen.findByRole("button", { name: "Select entire location" }));
		await userEvent.click(screen.getByRole("button", { name: "Create Source" }));

		await waitFor(() => expect(submittedBody).toBeDefined());
		expect(submittedBody).toEqual({
			name: "Remote archive",
			sourceKind: "agent-filesystem",
			agentId: "archive-node",
			trustedRootId: "photos",
			relativePath: "",
		});
		expect(submittedBody).not.toHaveProperty("config");
		expect(submittedBody).not.toHaveProperty("autoRemount");
	});

	test("clears a remote selection when a background discovery refetch fails and requires a fresh selection", async () => {
		let discoveryShouldFail = false;
		server.use(
			http.get("/api/v1/volumes/source-machines", () => {
				if (discoveryShouldFail) {
					return HttpResponse.json({ message: "internal path probe failed" }, { status: 503 });
				}
				return HttpResponse.json([remoteMachine]);
			}),
			http.get("/api/v1/volumes/filesystem/browse", () =>
				HttpResponse.json({ directories: [], path: "trusted-root:" }),
			),
		);

		const view = render(<CreateVolumePage />);
		await userEvent.click(await screen.findByLabelText("Another machine"));
		await userEvent.type(screen.getByLabelText("Source name"), "Remote archive");
		await userEvent.click(await screen.findByLabelText("Remote machine"));
		await userEvent.click(screen.getByRole("option", { name: "Archive node · available" }));
		await userEvent.click(await screen.findByLabelText("Allowed location"));
		await userEvent.click(screen.getByRole("option", { name: "Family photos" }));
		await userEvent.click(screen.getByRole("button", { name: "Change" }));
		await userEvent.click(await screen.findByRole("button", { name: "Select entire location" }));
		const submitButton = screen.getByRole("button", { name: "Create Source" });
		expect(submitButton.hasAttribute("disabled")).toBe(false);

		discoveryShouldFail = true;
		const sourceMachinesQuery = listSourceMachinesOptions();
		await view.queryClient.refetchQueries({ queryKey: sourceMachinesQuery.queryKey });

		expect(await screen.findByText("Available machines could not be loaded.")).toBeTruthy();
		expect(view.queryClient.getQueryData(sourceMachinesQuery.queryKey)).toEqual([remoteMachine]);
		expect(screen.queryByRole("button", { name: "Select entire location" })).toBeNull();
		expect(submitButton.hasAttribute("disabled")).toBe(true);
		expect(screen.queryByText("internal path probe failed")).toBeNull();

		discoveryShouldFail = false;
		server.use(http.get("/api/v1/volumes/source-machines", () => HttpResponse.json([remoteMachine])));
		await userEvent.click(screen.getByRole("button", { name: "Retry" }));
		await waitFor(() =>
			expect(view.queryClient.getQueryState(sourceMachinesQuery.queryKey)?.status).toBe("success"),
		);
		await userEvent.click(await screen.findByLabelText("Another machine"));
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
});
