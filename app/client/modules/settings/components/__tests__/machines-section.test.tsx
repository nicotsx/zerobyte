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

import { MachinesSection } from "../machines-section";

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

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
	navigate.mockClear();
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
		expect(document.body.textContent).not.toContain(unsafeName);
		await userEvent.click(screen.getByRole("button", { name: "Actions for Archive node" }));
		await userEvent.click(screen.getByRole("menuitem", { name: "Delete machine" }));
		expect(screen.getByRole("alertdialog", { name: "Delete Archive node?" }).textContent).not.toContain(unsafeName);
	});
});

test("opens the dedicated wizard for new machines and reconnects", async () => {
	server.use(http.get("/api/v1/agents", () => HttpResponse.json([localAgent, createAgent()])));
	render(<MachinesSection />);
	await userEvent.click(await screen.findByRole("button", { name: "Connect machine" }));
	expect(navigate).toHaveBeenCalledWith({ to: "/settings/machines/connect", search: { scope: "organization" } });
	await userEvent.click(screen.getByRole("button", { name: "Actions for Archive node" }));
	await userEvent.click(screen.getByRole("menuitem", { name: "Get connection command" }));
	expect(navigate).toHaveBeenCalledWith({
		to: "/settings/machines/connect",
		search: { agentId: "agent-remote", scope: "organization" },
	});
});

test.each([
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
