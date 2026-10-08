import { afterEach, describe, expect, test, vi } from "vitest";
import { listAgentsOptions } from "~/client/api-client/@tanstack/react-query.gen";
import type { ListAgentsResponse } from "~/client/api-client/types.gen";
import { HttpResponse, http, server } from "~/test/msw/server";
import {
	cleanup,
	createTestQueryClient,
	fireEvent,
	render,
	screen,
	userEvent,
	waitFor,
	within,
} from "~/test/test-utils";
import { CredentialDialog } from "../machine-connection-dialogs";
import { MachinesSection } from "../machines-section";

vi.mock("~/client/lib/datetime", () => ({
	useTimeFormat: () => ({ formatDateTime: (value: number) => new Date(value).toISOString() }),
}));

type Agent = ListAgentsResponse[number];

const emptyCapabilities: Agent["capabilities"] = {
	hostname: null,
	platform: null,
	agentVersion: null,
	resticVersion: null,
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
});

describe("MachinesSection", () => {
	test("renders preloaded machines immediately while refreshing in the background", () => {
		server.use(http.get("/api/v1/agents", () => HttpResponse.json([localAgent])));
		const queryClient = createTestQueryClient();
		queryClient.setQueryData(listAgentsOptions().queryKey, [localAgent]);

		render(<MachinesSection />, { queryClient, withSuspense: true });

		expect(screen.getByRole("heading", { name: "Zerobyte server" })).toBeTruthy();
		expect(screen.queryByLabelText("Loading machines")).toBeNull();
	});

	test("keeps last known machines visible when a refresh fails", async () => {
		let available = true;
		const remoteAgent = createAgent();
		server.use(
			http.get("/api/v1/agents", () =>
				available ? HttpResponse.json([localAgent, remoteAgent]) : HttpResponse.json({}, { status: 503 }),
			),
		);

		const { queryClient } = render(<MachinesSection />);
		expect(await screen.findByRole("heading", { name: "Archive node" })).toBeTruthy();

		available = false;
		await queryClient.refetchQueries({ queryKey: listAgentsOptions().queryKey });

		const error = await screen.findByRole("alert");
		expect(within(error).getByText("Could not refresh machines")).toBeTruthy();
		expect(screen.getByRole("heading", { name: "Archive node" })).toBeTruthy();
		expect(screen.getByText("1 remote machine")).toBeTruthy();
	});

	test("renders safe responsive machine details and keeps the local machine immutable", async () => {
		const remoteAgent = createAgent({
			status: "offline",
			lastSeenAt: Date.UTC(2026, 7, 9, 10, 30),
			capabilities: {
				...emptyCapabilities,
				hostname: "archive-01",
				platform: "linux",
				agentVersion: "v0.30.0",
				resticVersion: "0.18.1",
				trustedRoots: [{ id: "documents", label: "Documents", canBackup: true }],
			},
		});
		server.use(http.get("/api/v1/agents", () => HttpResponse.json([localAgent, remoteAgent])));

		render(<MachinesSection />);

		expect(await screen.findByRole("heading", { name: "Zerobyte server" })).toBeTruthy();
		expect(screen.getByText("This Zerobyte server.")).toBeTruthy();
		expect(screen.getByRole("heading", { name: "Archive node" })).toBeTruthy();
		expect(screen.getByText("Allowed locations (last reported)")).toBeTruthy();
		expect(screen.getByText("Agent v0.30.0")).toBeTruthy();
		expect(screen.getByText("Restic 0.18.1")).toBeTruthy();
		expect(screen.getByText("Documents")).toBeTruthy();
		expect(screen.getByText(/Backup allowed/)).toBeTruthy();
		expect(screen.queryByRole("button", { name: /Zerobyte server/ })).toBeNull();
	});

	test("trims enrollment names, presents the single-use connection command once, and reports awaited copying", async () => {
		let submittedName = "";
		server.use(
			http.get("/api/v1/agents", () => HttpResponse.json([localAgent])),
			http.post("/api/v1/agents", async ({ request }) => {
				const body = (await request.json()) as { name: string };
				submittedName = body.name;
				const agent = createAgent({ name: body.name });
				return HttpResponse.json(
					{ agent, controllerUrl, token: "one-time-token", expiresAt: Date.now() + 900000 },
					{ status: 201 },
				);
			}),
		);

		const { queryClient } = render(<MachinesSection />);
		const connectButton = await screen.findByRole("button", { name: "Connect machine" });
		await userEvent.click(connectButton);
		expect(
			screen.getByText(/For an existing installation, close this dialog and use that machine’s Actions menu/),
		).toBeTruthy();
		await userEvent.type(screen.getByLabelText("Machine name"), "  Off-site vault  ");
		await userEvent.click(screen.getByRole("button", { name: "Get connection command" }));

		const dialog = await screen.findByRole("dialog", { name: "Connect Off-site vault" });
		expect(submittedName).toBe("Off-site vault");
		expect(
			(within(dialog).getByRole("textbox", { name: "Connection command" }) as HTMLTextAreaElement).value,
		).toContain("--code 'one-time-token'");
		expect(
			(within(dialog).getByRole("textbox", { name: "Connection command" }) as HTMLTextAreaElement).value,
		).toContain("https://zerobyte.app/install.sh");
		expect(
			(within(dialog).getByRole("textbox", { name: "Connection command" }) as HTMLTextAreaElement).value,
		).toMatch(/sudo env ZEROBYTE_AGENT_VERSION=.* bash -s --/);
		expect(within(dialog).getByText(/Restic 0.18.0 or newer/)).toBeTruthy();
		expect(within(dialog).getByRole("link", { name: "Installation guide" }).getAttribute("href")).toContain(
			"/docs/guides/remote-agents",
		);
		expect(within(dialog).queryByRole("checkbox")).toBeNull();
		expect(within(dialog).queryByRole("alert")).toBeNull();
		expect(
			within(dialog).getByText(/Existing Allowed locations, permissions, and Sources are preserved/),
		).toBeTruthy();

		expect(within(dialog).queryByLabelText("Folder to allow on the remote machine")).toBeNull();
		expect(JSON.stringify(getCachedMutationData(queryClient))).toContain("one-time-token");

		await userEvent.click(within(dialog).getByRole("button", { name: "Copy connection command" }));
		expect(await within(dialog).findByText("Connection command copied.")).toBeTruthy();
		await userEvent.click(within(dialog).getByRole("button", { name: "Close connection command" }));

		await waitFor(() => expect(screen.queryByRole("textbox", { name: "Connection command" })).toBeNull());
		await waitFor(() => expect(JSON.stringify(getCachedMutationData(queryClient))).not.toContain("one-time-token"));
		expect(document.activeElement).toBe(connectButton);
	});

	test.each(["archive\u0000node", "archive\u202enode"])(
		"blocks enrollment names containing Unicode Cc/Cf characters: %j",
		async (name) => {
			let createCalled = false;
			server.use(
				http.get("/api/v1/agents", () => HttpResponse.json([localAgent])),
				http.post("/api/v1/agents", () => {
					createCalled = true;
					return HttpResponse.json({}, { status: 201 });
				}),
			);

			render(<MachinesSection />);
			await userEvent.click(await screen.findByRole("button", { name: "Connect machine" }));
			const input = screen.getByLabelText("Machine name");
			fireEvent.change(input, { target: { value: name } });

			expect(input.getAttribute("aria-invalid")).toBe("true");
			const validationMessage = screen.getByRole("alert");
			expect(validationMessage.textContent).toMatch(/without invisible control or formatting characters/i);
			const describedBy = input.getAttribute("aria-describedby")?.split(" ") ?? [];
			expect(describedBy).toContain(validationMessage.id);
			const issueCredentialButton = screen.getByRole("button", { name: "Get connection command" });
			expect(issueCredentialButton.hasAttribute("disabled")).toBe(true);
			fireEvent.submit(input.closest("form")!);
			expect(createCalled).toBe(false);
		},
	);

	test("sanitizes legacy invalid names before machine headings, actions, and dialogs", async () => {
		const unsafeName = "Archive\u202e\u0000 node";
		const unsafeAgent = createAgent({ id: "unsafe", name: unsafeName });
		const unnamedAgent = createAgent({ id: "unnamed", name: "\u202e\u0000" });
		const agents = [localAgent, unsafeAgent, unnamedAgent];
		server.use(http.get("/api/v1/agents", () => HttpResponse.json(agents)));

		render(<MachinesSection />);

		expect(await screen.findByRole("heading", { name: "Archive node" })).toBeTruthy();
		expect(screen.getByRole("heading", { name: "Unnamed machine" })).toBeTruthy();
		expect(screen.getByRole("button", { name: "Actions for Unnamed machine" })).toBeTruthy();
		const rotateButton = screen.getByRole("button", { name: "Actions for Archive node" });
		expect(document.body.textContent).not.toContain(unsafeName);
		await userEvent.click(rotateButton);
		await userEvent.click(screen.getByRole("menuitem", { name: "Get connection command" }));

		const dialog = screen.getByRole("alertdialog", { name: "Get connection command" });
		expect(within(dialog).getByText(/^Archive node will disconnect/)).toBeTruthy();
		expect(dialog.textContent).not.toContain(unsafeName);
	});

	test("reissues revoked credentials and revokes active machines with explicit consequences", async () => {
		const revokedAgent = createAgent({
			id: "revoked",
			name: "Cold store",
			status: "online",
			revokedAt: 100,
			lastSeenAt: 100,
		});
		const activeAgent = createAgent({ id: "active", name: "Media node", status: "online" });
		const agents = [localAgent, revokedAgent, activeAgent];
		let revokeCalled = false;
		server.use(
			http.get("/api/v1/agents", () => HttpResponse.json(agents)),
			http.post("/api/v1/agents/revoked/token/rotate", () =>
				HttpResponse.json({
					agent: { ...revokedAgent, revokedAt: null },
					controllerUrl,
					token: "replacement-token",
					expiresAt: Date.now() + 900000,
				}),
			),
			http.delete("/api/v1/agents/active/token", () => {
				revokeCalled = true;
				return HttpResponse.json({ ...activeAgent, revokedAt: 200 });
			}),
		);

		const { queryClient } = render(<MachinesSection />);
		expect((await screen.findAllByText("Revoked")).length).toBe(1);
		await userEvent.click(screen.getByRole("button", { name: "Actions for Cold store" }));
		await userEvent.click(screen.getByRole("menuitem", { name: "Get connection command" }));
		const rotationDialog = screen.getByRole("alertdialog", { name: "Get connection command" });
		expect(within(rotationDialog).getByText(/disconnect immediately/)).toBeTruthy();
		await userEvent.click(within(rotationDialog).getByRole("button", { name: "Get connection command" }));
		const credentialDialog = await screen.findByRole("dialog", { name: "Connect Cold store" });
		expect(
			(within(credentialDialog).getByRole("textbox", { name: "Connection command" }) as HTMLTextAreaElement)
				.value,
		).toContain("--code 'replacement-token'");
		expect(
			(within(credentialDialog).getByRole("textbox", { name: "Connection command" }) as HTMLTextAreaElement)
				.value,
		).toContain("https://canonical.example.test");
		expect(JSON.stringify(getCachedMutationData(queryClient))).toContain("replacement-token");
		await userEvent.click(screen.getByRole("button", { name: "Close connection command" }));
		expect(JSON.stringify(getCachedMutationData(queryClient))).not.toContain("replacement-token");

		await userEvent.click(screen.getByRole("button", { name: "Actions for Media node" }));
		await userEvent.click(screen.getByRole("menuitem", { name: "Revoke connection" }));
		const revokeDialog = screen.getByRole("alertdialog", { name: "Revoke Media node" });
		expect(within(revokeDialog).getByText(/Existing Sources are retained/)).toBeTruthy();
		await userEvent.click(within(revokeDialog).getByRole("button", { name: "Revoke" }));
		await waitFor(() => expect(revokeCalled).toBe(true));
	});
});

test.each(["ws://controller.test/api/v1/agents/connect", "http://controller.test"])(
	"warns before showing an insecure enrollment command for %s",
	(controllerUrl) => {
		render(
			<CredentialDialog
				credential={{
					machineName: "Archive node",
					controllerUrl,
					token: "development-code",
					expiresAt: Date.now() + 900000,
				}}
				onClose={vi.fn()}
				returnFocusRef={{ current: null }}
			/>,
		);

		const dialog = screen.getByRole("dialog", { name: "Connect Archive node" });
		const warning = within(dialog).getByRole("alert");
		expect(warning.textContent).toContain("unencrypted HTTP");
		expect(warning.textContent).toContain("development controllers only");
		expect(warning.textContent).toContain("Production requires HTTPS");
		expect(warning.textContent).toContain("TRUST_PROXY=true");
		expect(
			(within(dialog).getByRole("textbox", { name: "Connection command" }) as HTMLTextAreaElement).value,
		).toContain("--allow-insecure");
	},
);

test("clipboard rejection visibly selects the complete command for manual copying", async () => {
	server.use(
		http.get("/api/v1/agents", () => HttpResponse.json([localAgent])),
		http.post("/api/v1/agents", () =>
			HttpResponse.json(
				{
					agent: createAgent(),
					controllerUrl,
					token: "copy-code",
					expiresAt: Date.now() + 900000,
				},
				{ status: 201 },
			),
		),
	);
	vi.spyOn(navigator.clipboard, "writeText").mockRejectedValue(new Error("Clipboard denied"));

	render(<MachinesSection />);
	await userEvent.click(await screen.findByRole("button", { name: "Connect machine" }));
	await userEvent.type(screen.getByLabelText("Machine name"), "Archive node");
	await userEvent.click(screen.getByRole("button", { name: "Get connection command" }));
	const dialog = await screen.findByRole("dialog", { name: "Connect Archive node" });
	await userEvent.click(within(dialog).getByRole("button", { name: "Copy connection command" }));

	expect(await within(dialog).findByText(/Could not copy. The command is selected/)).toBeTruthy();
	const command = within(dialog).getByRole("textbox", { name: "Connection command" }) as HTMLTextAreaElement;
	expect(document.activeElement).toBe(command);
	expect(command.selectionStart).toBe(0);
	expect(command.selectionEnd).toBe(command.value.length);
	expect(command.value).toContain("--code 'copy-code'");
});

test.each([
	{
		action: "Get connection command",
		title: "Get connection command",
		confirm: "Get connection command",
		method: "post",
		endpoint: "/api/v1/agents/agent-remote/token/rotate",
	},
	{
		action: "Revoke connection",
		title: "Revoke Archive node",
		confirm: "Revoke",
		method: "delete",
		endpoint: "/api/v1/agents/agent-remote/token",
	},
	{
		action: "Delete machine",
		title: "Delete Archive node?",
		confirm: "Delete machine",
		method: "delete",
		endpoint: "/api/v1/agents/agent-remote",
	},
] as const)(
	"$action reports a failure and returns focus to the row actions",
	async ({ action, title, confirm, method, endpoint }) => {
		server.use(
			http.get("/api/v1/agents", () => HttpResponse.json([localAgent, createAgent({ lastSeenAt: 100 })])),
			http[method](endpoint, () => HttpResponse.json({ message: "Unavailable" }, { status: 503 })),
		);

		render(<MachinesSection />);
		const actions = await screen.findByRole("button", { name: "Actions for Archive node" });
		await userEvent.click(actions);
		await userEvent.click(screen.getByRole("menuitem", { name: action }));
		const dialog = screen.getByRole("alertdialog", { name: title });
		await userEvent.click(within(dialog).getByRole("button", { name: confirm }));

		expect(await within(dialog).findByRole("alert")).toBeTruthy();
		await userEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));

		await waitFor(() => expect(document.activeElement).toBe(actions));
	},
);

test.each(
	[
		{
			action: "Revoke connection",
			confirm: "Revoke",
			endpoint: "/api/v1/agents/agent-remote/token",
			message: "Could not revoke the connection. Try again.",
		},
		{
			action: "Delete machine",
			confirm: "Delete machine",
			endpoint: "/api/v1/agents/agent-remote",
			message: "Could not delete the machine. Try again.",
		},
	].flatMap((action) =>
		[
			{ format: "HTML", body: "<html>Service unavailable</html>", contentType: "text/html" },
			{ format: "empty", body: null, contentType: "text/plain" },
			{ format: "plain-text", body: "Service unavailable", contentType: "text/plain" },
		].map((failure) => ({ ...action, ...failure })),
	),
)("$action reports $format failures", async ({ action, confirm, endpoint, message, body, contentType }) => {
	server.use(
		http.get("/api/v1/agents", () => HttpResponse.json([localAgent, createAgent()])),
		http.delete(endpoint, () => new HttpResponse(body, { status: 503, headers: { "Content-Type": contentType } })),
	);

	render(<MachinesSection />);
	await userEvent.click(await screen.findByRole("button", { name: "Actions for Archive node" }));
	await userEvent.click(screen.getByRole("menuitem", { name: action }));
	const dialog = screen.getByRole("alertdialog");
	await userEvent.click(within(dialog).getByRole("button", { name: confirm }));

	expect((await within(dialog).findByRole("alert")).textContent).toBe(message);
});

test("deletion uses the safe row name and restores focus after Cancel, Escape, and successful removal", async () => {
	const agent = createAgent({ name: "Archive\u202e\u0000 node" });
	let removed = false;
	server.use(
		http.get("/api/v1/agents", () => HttpResponse.json(removed ? [localAgent] : [localAgent, agent])),
		http.delete("/api/v1/agents/agent-remote", () => {
			removed = true;
			return HttpResponse.json({ success: true });
		}),
	);

	render(<MachinesSection />);
	const actions = await screen.findByRole("button", { name: "Actions for Archive node" });
	for (const dismissal of ["Cancel", "Escape"]) {
		await userEvent.click(actions);
		await userEvent.click(screen.getByRole("menuitem", { name: "Delete machine" }));
		const dialog = screen.getByRole("alertdialog", { name: "Delete Archive node?" });
		expect(dialog.textContent).not.toContain(agent.name);
		if (dismissal === "Cancel") await userEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
		else fireEvent.keyDown(dialog, { key: "Escape" });
		await waitFor(() => expect(document.activeElement).toBe(actions));
	}

	await userEvent.click(actions);
	await userEvent.click(screen.getByRole("menuitem", { name: "Delete machine" }));
	await userEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Delete machine" }));
	await waitFor(() => expect(screen.queryByRole("heading", { name: "Archive node" })).toBeNull());
	expect(document.activeElement).toBe(screen.getByRole("button", { name: "Connect machine" }));
});
