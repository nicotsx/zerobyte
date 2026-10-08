import { afterEach, describe, expect, test, vi } from "vitest";
import type { ListAgentsResponse } from "~/client/api-client/types.gen";
import { HttpResponse, http, server } from "~/test/msw/server";
import { cleanup, fireEvent, render, screen, userEvent, waitFor, within } from "~/test/test-utils";
import { listAgentsQueryKey } from "~/client/api-client/@tanstack/react-query.gen";
import { createTestQueryClient } from "~/test/test-utils";
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

afterEach(() => cleanup());

describe("MachinesSection", () => {
	test("renders preloaded machines immediately while refreshing in the background", () => {
		server.use(http.get("/api/v1/agents", () => HttpResponse.json([localAgent])));
		const queryClient = createTestQueryClient();
		queryClient.setQueryData(listAgentsQueryKey(), [localAgent]);

		render(<MachinesSection />, { queryClient, withSuspense: true });

		expect(screen.getByRole("heading", { name: "Zerobyte server" })).toBeTruthy();
		expect(screen.queryByLabelText("Loading machines")).toBeNull();
	});

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

		render(<MachinesSection />);

		const localMachineHeading = await screen.findByRole("heading", { name: "Zerobyte server" });
		const localMachineRow = localMachineHeading.closest("li");
		if (!localMachineRow) throw new Error("Local machine row is missing");

		expect(within(localMachineRow).getByText("This Zerobyte server.")).toBeTruthy();
		expect(screen.getByRole("heading", { name: "Archive node" })).toBeTruthy();
		expect(screen.getByText("Allowed locations (last reported)")).toBeTruthy();
		expect(screen.getByText("Documents")).toBeTruthy();
		expect(screen.getByText(/Backup allowed/)).toBeTruthy();
		expect(within(localMachineRow).queryByRole("button")).toBeNull();
	});

	test("trims enrollment names and presents the single-use connection command", async () => {
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

		render(<MachinesSection />);
		await userEvent.click(await screen.findByRole("button", { name: "Connect machine" }));
		await userEvent.type(screen.getByLabelText("Machine name"), "  Off-site vault  ");
		await userEvent.click(screen.getByRole("button", { name: "Issue credential" }));

		const dialog = await screen.findByRole("dialog", { name: "Connect Off-site vault" });
		expect(submittedName).toBe("Off-site vault");
		expect(within(dialog).queryByLabelText("Folder to share from the remote machine")).toBeNull();
		const command = within(dialog).getByText(/--code 'one-time-token'/).textContent;
		expect(command).toContain("https://zerobyte.app/install.sh");
		expect(command).not.toMatch(/--root|\bbun\b|\.mjs/);
		expect(within(dialog).getByText("sudo zerobyte-agent folders add")).toBeTruthy();

		const alreadyInstalled = within(dialog).getByRole("checkbox", {
			name: "Agent already installed on this machine",
		});
		await userEvent.click(alreadyInstalled);
		expect(within(dialog).getByText(/--code 'one-time-token' --reconnect/)).toBeTruthy();
		await userEvent.click(alreadyInstalled);
		expect(within(dialog).getByText(/--code 'one-time-token'/).textContent).not.toContain("--reconnect");

		await userEvent.click(within(dialog).getByRole("button", { name: "Copy Connection command" }));
		expect(await within(dialog).findByText("Connection command copied")).toBeTruthy();
		await userEvent.click(within(dialog).getByRole("button", { name: "Done" }));

		await waitFor(() => expect(screen.queryByText(/one-time-token/)).toBeNull());
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
			const issueCredentialButton = screen.getByRole("button", { name: "Issue credential" });
			expect(issueCredentialButton.hasAttribute("disabled")).toBe(true);
			fireEvent.submit(input.closest("form")!);
			expect(createCalled).toBe(false);
		},
	);

	test("reissues revoked credentials and revokes active machines with explicit consequences", async () => {
		const revokedAgent = createAgent({
			id: "revoked",
			name: "Cold store",
			status: "online",
			lastSeenAt: 50,
			revokedAt: 100,
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
					expiresAt: 1,
				}),
			),
			http.delete("/api/v1/agents/active/token", () => {
				revokeCalled = true;
				return HttpResponse.json({ ...activeAgent, revokedAt: 200 });
			}),
		);

		render(<MachinesSection />);
		expect((await screen.findAllByText("Revoked")).length).toBe(1);
		await userEvent.click(screen.getByRole("button", { name: "Issue new credential for Cold store" }));
		const rotationDialog = screen.getByRole("alertdialog", { name: "Issue new credential" });
		expect(within(rotationDialog).getByText(/disconnect immediately/)).toBeTruthy();
		await userEvent.click(within(rotationDialog).getByRole("button", { name: "Issue new credential" }));
		const credentialDialog = await screen.findByRole("dialog", { name: "Connect Cold store" });
		expect(within(credentialDialog).getByText(/--code 'replacement-token' --reconnect/)).toBeTruthy();
		expect(within(credentialDialog).getByText(/https:\/\/canonical.example.test/)).toBeTruthy();
		await userEvent.click(screen.getByRole("button", { name: "Done" }));

		await userEvent.click(screen.getByRole("button", { name: "Revoke Media node" }));
		const revokeDialog = screen.getByRole("alertdialog", { name: "Revoke Media node?" });
		expect(within(revokeDialog).getByText(/Existing sources are kept/)).toBeTruthy();
		await userEvent.click(within(revokeDialog).getByRole("button", { name: "Revoke" }));
		await waitFor(() => expect(revokeCalled).toBe(true));
	});
});
