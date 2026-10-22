import { afterEach, expect, test, vi } from "vitest";
import { listAgentsOptions } from "~/client/api-client/@tanstack/react-query.gen";
import type { ListAgentsResponse } from "~/client/api-client/types.gen";
import { HttpResponse, http, server } from "~/test/msw/server";
import { act, cleanup, fireEvent, render, screen, userEvent, waitFor } from "~/test/test-utils";
import { DeploymentInstructions } from "../../components/machine-setup-forms";
import { MachineSetupPage } from "../machine-setup";

const { navigate } = vi.hoisted(() => ({ navigate: vi.fn() }));
vi.mock("@tanstack/react-router", async (importOriginal) => ({
	...(await importOriginal<typeof import("@tanstack/react-router")>()),
	useNavigate: () => navigate,
}));

vi.mock("~/client/lib/datetime", () => ({
	useTimeFormat: () => ({ formatDateTime: (value: number) => new Date(value).toISOString() }),
}));

type Agent = ListAgentsResponse[number];

const emptyCapabilities: Agent["capabilities"] = {
	hostname: null,
	platform: null,
	agentVersion: null,
	resticVersion: null,
	connectionSecurity: null,
	trustedRoots: [],
};

const createAgent = (overrides: Partial<Agent> = {}): Agent => ({
	id: "agent-remote",
	organizationId: "org-one",
	name: "Archive node",
	kind: "remote",
	status: "offline",
	capabilities: emptyCapabilities,
	lastSeenAt: null,
	lastReadyAt: null,
	createdAt: 1,
	updatedAt: 1,
	revokedAt: null,
	credentialVersion: 1,
	...overrides,
});

const localAgent = createAgent({
	id: "local",
	organizationId: null,
	name: "Zerobyte server",
	kind: "local",
	status: "online",
});

const controllerUrl = "wss://canonical.example.test/api/v1/agents/connect";

const getCachedMutationData = (queryClient: ReturnType<typeof render>["queryClient"]) => {
	return queryClient
		.getMutationCache()
		.getAll()
		.map((mutation) => mutation.state.data);
};

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
	navigate.mockClear();
});

const credential = (agent = createAgent(), expiresAt = Date.now() + 900_000) => ({
	agent,
	controllerUrl,
	token: "one-time-token",
	expiresAt,
});

const startNewMachine = async () => {
	await userEvent.type(screen.getByRole("textbox", { name: "Machine name" }), "  Archive node  ");
	await userEvent.click(screen.getByRole("button", { name: "Continue" }));
	await screen.findByRole("textbox", { name: "Connection command" });
};

const refreshAgents = async (queryClient: ReturnType<typeof render>["queryClient"]) => {
	await act(async () => {
		await queryClient.refetchQueries(listAgentsOptions());
	});
};

test("creates a named machine and lets both deployment methods use the same single-use code", async () => {
	let calls = 0;
	let submittedName = "";
	server.use(
		http.get("/api/v1/agents", () => HttpResponse.json(calls ? [localAgent, createAgent()] : [localAgent])),
		http.post("/api/v1/agents", async ({ request }) => {
			calls++;
			submittedName = ((await request.json()) as { name: string }).name;
			return HttpResponse.json(credential(), { status: 201 });
		}),
	);
	const copy = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
	const { queryClient, unmount } = render(<MachineSetupPage />);
	await startNewMachine();

	expect(submittedName).toBe("Archive node");
	expect(screen.getByText(/Waiting for Archive node/)).toBeTruthy();
	expect(screen.getByRole("tab", { name: "Linux installer" }).getAttribute("aria-selected")).toBe("true");
	const command = screen.getByRole("textbox", { name: "Connection command" }) as HTMLTextAreaElement;
	expect(command.value).toContain("--code 'one-time-token'");
	expect(command.value).toContain("https://zerobyte.app/install.sh");
	expect(screen.getByText("Copy and run this command on Archive node.")).toBeTruthy();
	expect(screen.getByRole("link", { name: "Setup guide" })).toBeTruthy();
	await userEvent.click(screen.getByRole("button", { name: "Copy connection command" }));
	expect(await screen.findByText("Connection command copied.")).toBeTruthy();

	await userEvent.click(screen.getByRole("tab", { name: "Docker" }));
	const compose = screen.getByRole("textbox", { name: "Docker Compose configuration" }) as HTMLTextAreaElement;
	expect(compose.value).toContain('ZEROBYTE_CONTROLLER_URL: "https://canonical.example.test"');
	expect(compose.value).toContain('ZEROBYTE_AGENT_ENROLLMENT_CODE: "one-time-token"');
	expect(screen.getByText(/Save this as/)).toBeTruthy();
	expect(screen.queryByText(/glibc and systemd/)).toBeNull();
	await userEvent.click(screen.getByRole("button", { name: "Copy docker compose configuration" }));
	expect(copy).toHaveBeenCalledWith(compose.value);
	expect(await screen.findByText("Docker Compose configuration copied.")).toBeTruthy();
	expect(calls).toBe(1);
	unmount();
	await waitFor(() => expect(JSON.stringify(getCachedMutationData(queryClient))).not.toContain("one-time-token"));
});

test.each(["archive\u0000node", "archive\u202enode"])("rejects invisible characters in machine names: %j", (name) => {
	server.use(http.get("/api/v1/agents", () => HttpResponse.json([localAgent])));
	render(<MachineSetupPage />);
	const input = screen.getByRole("textbox", { name: "Machine name" });
	fireEvent.change(input, { target: { value: name } });
	expect(input.getAttribute("aria-invalid")).toBe("true");
	expect(screen.getByRole("alert").textContent).toMatch(/without invisible control or formatting characters/);
	expect(screen.getByRole("button", { name: "Continue" }).hasAttribute("disabled")).toBe(true);
});

test("waits for the newly enrolled credential to be ready before showing success and clears the code", async () => {
	let agent = createAgent({ status: "online", credentialVersion: 5 });
	let rotations = 0;
	server.use(
		http.get("/api/v1/agents", () => HttpResponse.json([localAgent, agent])),
		http.post("/api/v1/agents/agent-remote/token/rotate", () => {
			rotations++;
			return HttpResponse.json(credential(createAgent({ credentialVersion: 6 })));
		}),
	);
	const { queryClient } = render(<MachineSetupPage agentId="agent-remote" />);
	expect(await screen.findByText(/This disconnects the machine until you finish setup/)).toBeTruthy();
	expect(screen.queryByRole("textbox", { name: "Machine name" })).toBeNull();
	expect(rotations).toBe(0);
	await userEvent.click(screen.getByRole("button", { name: /Get new connection code/ }));
	await screen.findByRole("textbox", { name: "Connection command" });
	expect(screen.queryByText("Connection successful")).toBeNull();

	for (const status of ["offline", "connecting", "degraded"] as const) {
		agent = createAgent({ status, credentialVersion: 7 });
		await refreshAgents(queryClient);
		expect(screen.queryByText("Connection successful")).toBeNull();
	}
	expect(await screen.findByText(/Couldn’t finish connecting/)).toBeTruthy();

	agent = createAgent({
		status: "online",
		credentialVersion: 7,
		capabilities: {
			hostname: "archive-host",
			platform: "linux",
			agentVersion: "v1.0.0-beta.2",
			resticVersion: "0.18.0",
			connectionSecurity: "secure",
			trustedRoots: [{ id: "files-1", label: "Files", canBackup: true }],
		},
	});
	await refreshAgents(queryClient);
	expect(await screen.findByRole("heading", { name: "Connection successful" })).toBeTruthy();
	expect(screen.getByText("Archive node is connected")).toBeTruthy();
	expect(screen.getByText(/archive-host/)).toBeTruthy();
	expect(screen.getByText("Agent v1.0.0-beta.2")).toBeTruthy();
	expect(screen.getByRole("list", { name: "Allowed locations" }).textContent).toContain("Files");
	expect(screen.getByRole("button", { name: "Create a Source" })).toBeTruthy();
	expect(screen.queryByRole("textbox", { name: "Connection command" })).toBeNull();
	expect(JSON.stringify(getCachedMutationData(queryClient))).not.toContain("one-time-token");
	await userEvent.click(screen.getByRole("button", { name: "Done" }));
	expect(navigate).toHaveBeenCalledWith({ to: "/settings", search: { scope: "organization" }, hash: "machines" });
});

test("shows expired codes without deployment instructions and confirms before reissuing", async () => {
	const agent = createAgent();
	let calls = 0;
	server.use(
		http.get("/api/v1/agents", () => HttpResponse.json([agent])),
		http.post("/api/v1/agents/agent-remote/token/rotate", () => {
			calls++;
			return HttpResponse.json(credential(agent, calls === 1 ? Date.now() + 100 : Date.now() + 900000));
		}),
	);
	render(<MachineSetupPage agentId={agent.id} />);
	await userEvent.click(await screen.findByRole("button", { name: /Get new connection code/ }));
	await screen.findByRole("textbox", { name: "Connection command" });
	expect(await screen.findByText("Connection code expired", {}, { timeout: 2500 })).toBeTruthy();
	expect(screen.queryByRole("textbox", { name: "Connection command" })).toBeNull();
	await userEvent.click(screen.getByRole("button", { name: "Reconnect machine" }));
	expect(screen.getByText(/This disconnects the machine until you finish setup/)).toBeTruthy();
	expect(calls).toBe(1);
	await userEvent.click(screen.getByRole("button", { name: /Get new connection code/ }));
	expect(await screen.findByRole("textbox", { name: "Connection command" })).toBeTruthy();
	expect(calls).toBe(2);
});

test.each(["revoked", "replaced", "deleted"])("does not report success when enrollment is %s", async (change) => {
	let agent: Agent | null = createAgent();
	server.use(
		http.get("/api/v1/agents", () => HttpResponse.json(agent ? [agent] : [])),
		http.post("/api/v1/agents/agent-remote/token/rotate", () => HttpResponse.json(credential())),
	);
	const { queryClient } = render(<MachineSetupPage agentId="agent-remote" />);
	await userEvent.click(await screen.findByRole("button", { name: /Get new connection code/ }));
	await screen.findByRole("textbox", { name: "Connection command" });
	agent =
		change === "deleted"
			? null
			: createAgent({
					status: "online",
					credentialVersion: change === "replaced" ? 3 : 2,
					revokedAt: change === "revoked" ? 100 : null,
				});
	await refreshAgents(queryClient);
	expect(await screen.findByText("Connection code no longer valid")).toBeTruthy();
	expect(screen.queryByText("Connection successful")).toBeNull();
	expect(screen.queryByRole("textbox", { name: "Connection command" })).toBeNull();
});

test("a failed status check offers retry and cannot declare success from cached state", async () => {
	let fail = false;
	server.use(
		http.get("/api/v1/agents", () =>
			fail ? new HttpResponse(null, { status: 503 }) : HttpResponse.json([createAgent()]),
		),
		http.post("/api/v1/agents/agent-remote/token/rotate", () => HttpResponse.json(credential())),
	);
	const { queryClient } = render(<MachineSetupPage agentId="agent-remote" />);
	await userEvent.click(await screen.findByRole("button", { name: /Get new connection code/ }));
	await screen.findByRole("textbox", { name: "Connection command" });
	fail = true;
	await refreshAgents(queryClient);
	expect(await screen.findByText("Could not check the connection")).toBeTruthy();
	expect(screen.queryByText("Connection successful")).toBeNull();
	fail = false;
	await userEvent.click(screen.getByRole("button", { name: "Retry connection check" }));
	await waitFor(() => expect(screen.queryByText("Could not check the connection")).toBeNull());
});

test("a missing machine cannot issue a new code", async () => {
	server.use(http.get("/api/v1/agents", () => HttpResponse.json([localAgent])));
	render(<MachineSetupPage agentId="missing" />);
	expect(await screen.findByText("Machine unavailable")).toBeTruthy();
	expect(screen.queryByRole("button", { name: /Get new connection code/ })).toBeNull();
});

test.each(["create", "rotate"])("reports a failed %s without advancing", async (action) => {
	server.use(
		http.get("/api/v1/agents", () => HttpResponse.json([createAgent()])),
		http.post(
			action === "create" ? "/api/v1/agents" : "/api/v1/agents/agent-remote/token/rotate",
			() => new HttpResponse(null, { status: 503 }),
		),
	);
	render(<MachineSetupPage agentId={action === "rotate" ? "agent-remote" : undefined} />);
	if (action === "create") {
		await userEvent.type(screen.getByRole("textbox", { name: "Machine name" }), "Archive node");
		await userEvent.click(screen.getByRole("button", { name: "Continue" }));
	} else {
		await userEvent.click(await screen.findByRole("button", { name: /Get new connection code/ }));
	}
	expect(await screen.findByText(/Could not get/)).toBeTruthy();
	expect(screen.queryByRole("textbox", { name: "Connection command" })).toBeNull();
});

test.each(["ws://controller.test/api/v1/agents/connect", "http://controller.test"])(
	"warns about unencrypted enrollment for %s",
	(controllerUrl) => {
		render(<DeploymentInstructions credential={{ ...credential(), controllerUrl }} />);
		expect(screen.getByRole("alert").textContent).toContain("ZEROBYTE_AGENT_ALLOW_INSECURE_HTTP=true");
		expect((screen.getByRole("textbox", { name: "Connection command" }) as HTMLTextAreaElement).value).toContain(
			"--allow-insecure",
		);
	},
);

test("clipboard rejection selects the complete command for manual copying", async () => {
	vi.spyOn(navigator.clipboard, "writeText").mockRejectedValue(new Error("Clipboard denied"));
	render(<DeploymentInstructions credential={credential()} />);
	await userEvent.click(screen.getByRole("button", { name: "Copy connection command" }));
	expect(await screen.findByText(/Could not copy. The text is selected/)).toBeTruthy();
	const command = screen.getByRole("textbox", { name: "Connection command" }) as HTMLTextAreaElement;
	expect(document.activeElement).toBe(command);
	expect(command.selectionStart).toBe(0);
	expect(command.selectionEnd).toBe(command.value.length);
});
