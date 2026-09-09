import { afterEach, describe, expect, test, vi } from "vitest";
import type { ListAgentsResponse } from "~/client/api-client/types.gen";
import { HttpResponse, http, server } from "~/test/msw/server";
import { cleanup, fireEvent, render, screen, userEvent, waitFor, within } from "~/test/test-utils";
import { MachinesSection } from "../machines-section";

vi.mock("~/client/lib/datetime", () => ({
	useTimeFormat: () => ({ formatDateTime: (value: number) => new Date(value).toISOString() }),
}));

type Agent = ListAgentsResponse[number];

const emptyCapabilities: Agent["capabilities"] = { hostname: null, platform: null, trustedRoots: [] };

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

afterEach(() => cleanup());

describe("MachinesSection", () => {
	test("renders safe responsive machine details and keeps the local machine immutable", async () => {
		const remoteAgent = createAgent({
			status: "offline",
			lastSeenAt: Date.UTC(2026, 7, 9, 10, 30),
			capabilities: {
				hostname: "archive-01",
				platform: "linux",
				trustedRoots: [{ id: "documents", label: "Documents", canBackup: true }],
			},
		});
		server.use(http.get("/api/v1/agents", () => HttpResponse.json([localAgent, remoteAgent])));

		render(<MachinesSection controllerUrl={controllerUrl} />);

		expect(await screen.findByRole("heading", { name: "Zerobyte server" })).toBeTruthy();
		expect(screen.getByText("This Zerobyte server.")).toBeTruthy();
		expect(screen.getByRole("heading", { name: "Archive node" })).toBeTruthy();
		expect(screen.getByText("Trusted locations (last reported)")).toBeTruthy();
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

		const { queryClient } = render(<MachinesSection controllerUrl={controllerUrl} />);
		const connectButton = await screen.findByRole("button", { name: "Connect machine" });
		await userEvent.click(connectButton);
		await userEvent.type(screen.getByLabelText("Machine name"), "  Off-site vault  ");
		await userEvent.click(screen.getByRole("button", { name: "Issue credential" }));

		const dialog = await screen.findByRole("dialog", { name: "Credential for Off-site vault" });
		expect(submittedName).toBe("Off-site vault");
		expect(within(dialog).getByText(/--code 'one-time-token'/)).toBeTruthy();
		expect(within(dialog).getByText(/https:\/\/zerobyte.app\/install.sh/)).toBeTruthy();
		expect(within(dialog).getByText(/sudo env ZEROBYTE_AGENT_VERSION=.* bash -s --/)).toBeTruthy();
		expect(within(dialog).queryByText(/Restic 0.18.0 or newer/)).toBeNull();

		expect(within(dialog).queryByLabelText("Folder to allow on the remote machine")).toBeNull();
		expect(JSON.stringify(getCachedMutationData(queryClient))).toContain("one-time-token");

		await userEvent.click(within(dialog).getByRole("button", { name: "Copy connection command" }));
		expect(await within(dialog).findByText("connection command copied")).toBeTruthy();
		await userEvent.click(within(dialog).getByRole("button", { name: "Done" }));

		await waitFor(() => expect(screen.queryByText("one-time-token")).toBeNull());
		expect(JSON.stringify(getCachedMutationData(queryClient))).not.toContain("one-time-token");
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

			render(<MachinesSection controllerUrl={controllerUrl} />);
			await userEvent.click(await screen.findByRole("button", { name: "Connect machine" }));
			const input = screen.getByLabelText("Machine name");
			fireEvent.change(input, { target: { value: name } });

			expect(input.getAttribute("aria-invalid")).toBe("true");
			const validationMessage = screen.getByRole("alert");
			expect(validationMessage.textContent).toMatch(/without invisible control or formatting characters/i);
			const describedBy = input.getAttribute("aria-describedby")?.split(" ") ?? [];
			expect(describedBy).toContain(validationMessage.id);
			const issueCredentialButton = screen.getByRole("button", { name: "Issue credential" });
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

		render(<MachinesSection controllerUrl={controllerUrl} />);

		expect(await screen.findByRole("heading", { name: "Archive node" })).toBeTruthy();
		expect(screen.getByRole("heading", { name: "Unnamed machine" })).toBeTruthy();
		expect(screen.getByRole("button", { name: "Rotate credential for Unnamed machine" })).toBeTruthy();
		const rotateButton = screen.getByRole("button", { name: "Rotate credential for Archive node" });
		expect(document.body.textContent).not.toContain(unsafeName);
		await userEvent.click(rotateButton);

		const dialog = screen.getByRole("alertdialog", { name: "Rotate credential" });
		expect(within(dialog).getByText(/^Archive node will disconnect/)).toBeTruthy();
		expect(dialog.textContent).not.toContain(unsafeName);
	});

	test("reissues revoked credentials and revokes active machines with explicit consequences", async () => {
		const revokedAgent = createAgent({ id: "revoked", name: "Cold store", status: "online", revokedAt: 100 });
		const activeAgent = createAgent({ id: "active", name: "Media node", status: "online" });
		const agents = [localAgent, revokedAgent, activeAgent];
		let revokeCalled = false;
		server.use(
			http.get("/api/v1/agents", () => HttpResponse.json(agents)),
			http.post("/api/v1/agents/revoked/token/rotate", () =>
				HttpResponse.json({ agent: { ...revokedAgent, revokedAt: null }, token: "replacement-token" }),
			),
			http.delete("/api/v1/agents/active/token", () => {
				revokeCalled = true;
				return HttpResponse.json({ ...activeAgent, revokedAt: 200 });
			}),
		);

		const { queryClient } = render(<MachinesSection controllerUrl={controllerUrl} />);
		expect((await screen.findAllByText("Revoked")).length).toBe(1);
		await userEvent.click(screen.getByRole("button", { name: "Issue new credential for Cold store" }));
		const rotationDialog = screen.getByRole("alertdialog", { name: "Issue new credential" });
		expect(within(rotationDialog).getByText(/disconnect immediately/)).toBeTruthy();
		await userEvent.click(within(rotationDialog).getByRole("button", { name: "Issue new credential" }));
		const credentialDialog = await screen.findByRole("dialog", { name: "Credential for Cold store" });
		expect(within(credentialDialog).getByText(/--code 'replacement-token'/)).toBeTruthy();
		expect(within(credentialDialog).getByText(/https:\/\/canonical.example.test/)).toBeTruthy();
		expect(JSON.stringify(getCachedMutationData(queryClient))).toContain("replacement-token");
		await userEvent.click(screen.getByRole("button", { name: "Done" }));
		expect(JSON.stringify(getCachedMutationData(queryClient))).not.toContain("replacement-token");

		await userEvent.click(screen.getByRole("button", { name: "Revoke Media node" }));
		const revokeDialog = screen.getByRole("alertdialog", { name: "Revoke Media node" });
		expect(within(revokeDialog).getByText(/Existing Sources are retained/)).toBeTruthy();
		await userEvent.click(within(revokeDialog).getByRole("button", { name: "Revoke" }));
		await waitFor(() => expect(revokeCalled).toBe(true));
	});
});
