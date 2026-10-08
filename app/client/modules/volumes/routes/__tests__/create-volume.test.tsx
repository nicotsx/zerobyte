import { afterEach, expect, test, vi } from "vitest";
import type { CreateVolumeData, ListSourceMachinesResponse } from "~/client/api-client/types.gen";
import { HttpResponse, http, server } from "~/test/msw/server";
import { cleanup, render, screen, userEvent, waitFor } from "~/test/test-utils";

const testState = vi.hoisted(() => ({ remoteAgents: true }));

vi.mock("@tanstack/react-router", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@tanstack/react-router")>();
	return { ...actual, useNavigate: (() => vi.fn()) as typeof actual.useNavigate };
});

vi.mock("~/client/hooks/use-system-info", () => ({
	useSystemInfo: () => ({
		runtime: "server",
		capabilities: {
			rclone: true,
			sysAdmin: true,
			volumeBackends: ["directory", "nfs", "smb", "webdav", "sftp", "rclone"],
			repositoryBackends: [],
		},
	}),
}));

vi.mock("~/client/hooks/use-permissions", () => ({
	usePermissions: () => ({
		can: () => false,
		hasRuntimeFeature: (feature: string) => feature === "remoteAgents" && testState.remoteAgents,
	}),
}));

import { CreateVolumePage } from "../create-volume";

const remoteMachine = {
	id: "archive-node",
	name: "Archive node",
	status: "online" as const,
	lastSeenAt: 1,
	revokedAt: null,
	trustedRoots: [{ id: "photos", label: "Family photos", canBackup: true }],
} satisfies ListSourceMachinesResponse[number];

afterEach(() => {
	testState.remoteAgents = true;
	cleanup();
});

test("hides remote sources when remote agents are disabled", async () => {
	testState.remoteAgents = false;
	render(<CreateVolumePage />);

	expect(await screen.findByLabelText("Name")).toBeTruthy();
	expect(screen.queryByLabelText("Another machine")).toBeNull();
});

test("submits a remote source without managed configuration", async () => {
	let submittedBody: CreateVolumeData["body"] | undefined;
	server.use(
		http.get("/api/v1/volumes/source-machines", () => HttpResponse.json([remoteMachine])),
		http.get("/api/v1/volumes/filesystem/browse", () => HttpResponse.json({ directories: [], path: "" })),
		http.post("/api/v1/volumes", async ({ request }) => {
			submittedBody = (await request.json()) as CreateVolumeData["body"];
			return HttpResponse.json({ shortId: "created-source" }, { status: 201 });
		}),
	);

	render(<CreateVolumePage />);
	await userEvent.click(await screen.findByLabelText("Another machine"));
	await userEvent.type(screen.getByLabelText("Name"), "Remote archive");
	await userEvent.click(await screen.findByLabelText("Machine"));
	await userEvent.click(screen.getByRole("option", { name: "Archive node · Online" }));
	await userEvent.click(screen.getByLabelText("Allowed location"));
	await userEvent.click(screen.getByRole("option", { name: "Family photos" }));
	await userEvent.click(screen.getByRole("button", { name: "Choose folder" }));
	await userEvent.click(screen.getByRole("button", { name: "Select entire location" }));
	await userEvent.click(screen.getByRole("button", { name: "Create Source" }));

	await waitFor(() =>
		expect(submittedBody).toEqual({
			sourceKind: "filesystem",
			name: "Remote archive",
			agentId: "archive-node",
			trustedRootId: "photos",
			relativePath: "",
		}),
	);
});
