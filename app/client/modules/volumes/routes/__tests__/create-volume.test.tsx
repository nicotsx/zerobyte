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
	test.each(["server", "desktop"] as const)(
		"keeps the local form and avoids discovery when remote agents are disabled on %s",
		async (runtime) => {
			let discoveryRequests = 0;
			testState.remoteAgents = false;
			testState.runtime = runtime;
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
		},
	);

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

	test("offers remote onboarding when no machines are connected", async () => {
		server.use(http.get("/api/v1/volumes/source-machines", () => HttpResponse.json([])));
		render(<CreateVolumePage />);

		expect((screen.getByLabelText("This server") as HTMLInputElement).checked).toBe(true);
		await userEvent.type(screen.getByLabelText("Name"), "Family archive");
		await userEvent.click(screen.getByLabelText("Another machine"));

		expect(await screen.findByText("Connect a remote machine in organization settings first.")).toBeTruthy();
		expect((screen.getByLabelText("Source name") as HTMLInputElement).value).toBe("Family archive");
		expect(screen.getByRole("link", { name: /Manage machines/ }).getAttribute("href")).toBe(
			"/settings?scope=organization#machines",
		);
		expect(screen.getByRole("button", { name: "Refresh locations" })).toBeTruthy();
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
		await userEvent.click(screen.getByLabelText("Directory Path"));
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
		await userEvent.click(screen.getByRole("option", { name: "Archive node · Available" }));
		await userEvent.click(await screen.findByLabelText("Allowed location"));
		await userEvent.click(screen.getByRole("option", { name: "Family photos" }));
		await userEvent.click(screen.getByLabelText("Folder"));
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

	test("keeps a selected subfolder through temporary discovery failure and revalidates it before save", async () => {
		let discoveryShouldFail = false;
		let selectedFolderIsAvailable = true;
		let submittedBody: CreateVolumeBody | undefined;
		server.use(
			http.get("/api/v1/volumes/source-machines", () =>
				discoveryShouldFail
					? HttpResponse.json({ message: "internal path probe failed" }, { status: 503 })
					: HttpResponse.json([remoteMachine]),
			),
			http.get("/api/v1/volumes/filesystem/browse", ({ request }) => {
				const path = new URL(request.url).searchParams.get("path");
				if (path === "")
					return HttpResponse.json({
						path: "trusted-root:",
						directories: [{ name: "albums", path: "trusted-root:albums", type: "directory" }],
					});
				if (!selectedFolderIsAvailable)
					return HttpResponse.json({ message: "Folder unavailable" }, { status: 503 });
				return HttpResponse.json({ path: "trusted-root:albums", directories: [] });
			}),
			http.post("/api/v1/volumes", async ({ request }) => {
				submittedBody = (await request.json()) as CreateVolumeBody;
				return HttpResponse.json({ shortId: "created-source" }, { status: 201 });
			}),
		);

		const view = render(<CreateVolumePage />);
		await userEvent.click(await screen.findByLabelText("Another machine"));
		await userEvent.type(screen.getByLabelText("Source name"), "Remote archive");
		await userEvent.click(screen.getByLabelText("Remote machine"));
		await userEvent.click(screen.getByRole("option", { name: "Archive node · Available" }));
		await userEvent.click(screen.getByLabelText("Allowed location"));
		await userEvent.click(screen.getByRole("option", { name: "Family photos" }));
		await userEvent.click(screen.getByLabelText("Folder"));
		await userEvent.click(await screen.findByRole("button", { name: "albums" }));
		await waitFor(() => expect(screen.getByLabelText("Folder").getAttribute("aria-invalid")).toBe("false"));

		discoveryShouldFail = true;
		await view.queryClient.refetchQueries({ queryKey: listSourceMachinesOptions().queryKey });
		expect(await screen.findByText("Available machines could not be loaded.")).toBeTruthy();
		const save = screen.getByRole("button", { name: "Create Source" });
		expect(save.hasAttribute("disabled")).toBe(true);
		expect(document.body.textContent).not.toContain("internal path probe failed");

		discoveryShouldFail = false;
		selectedFolderIsAvailable = false;
		await userEvent.click(screen.getByRole("button", { name: "Retry" }));
		expect(await screen.findByText("Family photos/albums")).toBeTruthy();
		expect(
			await screen.findByText("Could not load folders from this location. Retry or choose another folder."),
		).toBeTruthy();
		await userEvent.click(save);
		expect(submittedBody).toBeUndefined();

		selectedFolderIsAvailable = true;
		await userEvent.click(screen.getByRole("button", { name: "Retry loading folder" }));
		await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
		await userEvent.click(save);
		await waitFor(() =>
			expect(submittedBody).toEqual({
				name: "Remote archive",
				sourceKind: "agent-filesystem",
				agentId: "archive-node",
				trustedRootId: "photos",
				relativePath: "albums",
			}),
		);
	});
});

test("keeps the common name and NFS draft when inspecting the remote host", async () => {
	let submittedBody: CreateVolumeBody | undefined;
	server.use(
		http.get("/api/v1/volumes/source-machines", () => HttpResponse.json([remoteMachine])),
		http.post("/api/v1/volumes", async ({ request }) => {
			submittedBody = (await request.json()) as CreateVolumeBody;
			return HttpResponse.json({ shortId: "nfs-source" }, { status: 201 });
		}),
	);
	render(<CreateVolumePage />);
	await userEvent.type(screen.getByLabelText("Name"), "Archive");
	await userEvent.click(screen.getByRole("combobox", { name: "Backend" }));
	await userEvent.click(screen.getByRole("option", { name: "NFS" }));
	await userEvent.type(screen.getByLabelText("Server"), "nas.local");
	await userEvent.type(screen.getByLabelText("Export Path"), "/exports/archive");

	await userEvent.click(await screen.findByLabelText("Another machine"));
	expect((screen.getByLabelText("Source name") as HTMLInputElement).value).toBe("Archive");
	await userEvent.clear(screen.getByLabelText("Source name"));
	await userEvent.type(screen.getByLabelText("Source name"), "Home archive");
	await userEvent.click(screen.getByLabelText("This server"));

	expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe("Home archive");
	expect((screen.getByLabelText("Server") as HTMLInputElement).value).toBe("nas.local");
	expect((screen.getByLabelText("Export Path") as HTMLInputElement).value).toBe("/exports/archive");
	await userEvent.click(screen.getByRole("button", { name: "Create Source" }));
	await waitFor(() => expect(submittedBody).toBeDefined());
	expect(submittedBody).toMatchObject({
		name: "Home archive",
		config: { backend: "nfs", server: "nas.local", exportPath: "/exports/archive" },
	});
});

test("preserves the remote folder draft while rechecking it after a host switch", async () => {
	let folderIsAvailable = true;
	let submittedBody: CreateVolumeBody | undefined;
	server.use(
		http.get("/api/v1/volumes/source-machines", () => HttpResponse.json([remoteMachine])),
		http.get("/api/v1/volumes/filesystem/browse", ({ request }) => {
			const path = new URL(request.url).searchParams.get("path");
			if (path === "")
				return HttpResponse.json({
					path: "trusted-root:",
					directories: [{ name: "albums", path: "trusted-root:albums", type: "directory" }],
				});
			if (!folderIsAvailable) return HttpResponse.json({ message: "Folder unavailable" }, { status: 503 });
			return HttpResponse.json({ path: "trusted-root:albums", directories: [] });
		}),
		http.post("/api/v1/volumes", async ({ request }) => {
			submittedBody = (await request.json()) as CreateVolumeBody;
			return HttpResponse.json({ shortId: "remote-source" }, { status: 201 });
		}),
	);
	render(<CreateVolumePage />);
	await userEvent.click(await screen.findByLabelText("Another machine"));
	await userEvent.type(screen.getByLabelText("Source name"), "Archive");
	await userEvent.click(screen.getByLabelText("Remote machine"));
	await userEvent.click(screen.getByRole("option", { name: "Archive node · Available" }));
	await userEvent.click(screen.getByLabelText("Allowed location"));
	await userEvent.click(screen.getByRole("option", { name: "Family photos" }));
	await userEvent.click(screen.getByLabelText("Folder"));
	await userEvent.click(await screen.findByRole("button", { name: "albums" }));
	await waitFor(() => expect(screen.getByLabelText("Folder").getAttribute("aria-invalid")).toBe("false"));

	await userEvent.click(screen.getByLabelText("This server"));
	folderIsAvailable = false;
	await userEvent.click(screen.getByLabelText("Another machine"));
	expect(screen.getByText("Family photos/albums")).toBeTruthy();
	expect(
		await screen.findByText("Could not load folders from this location. Retry or choose another folder."),
	).toBeTruthy();
	await userEvent.click(screen.getByRole("button", { name: "Create Source" }));
	expect(submittedBody).toBeUndefined();

	folderIsAvailable = true;
	await userEvent.click(screen.getByRole("button", { name: "Retry loading folder" }));
	await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
	await userEvent.click(screen.getByRole("button", { name: "Create Source" }));
	await waitFor(() =>
		expect(submittedBody).toMatchObject({ sourceKind: "agent-filesystem", relativePath: "albums" }),
	);
});
