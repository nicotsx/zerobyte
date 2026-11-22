import { onlineManager } from "@tanstack/react-query";
import { afterEach, describe, expect, test, vi } from "vitest";
import { listAgentsOptions } from "~/client/api-client/@tanstack/react-query.gen";
import type { ListAgentsResponse } from "~/client/api-client/types.gen";
import { HttpResponse, http, server } from "~/test/msw/server";
import {
	act,
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

const agentsOptions = listAgentsOptions({ query: { expectedOrganizationId: "org-one" } });

const emptyCapabilities: Agent["capabilities"] = {
	connectionSecurity: null,
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
	update: { protocolVersion: null, availability: "none", delivery: null, targetTag: null, request: null },
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
		queryClient.setQueryData(agentsOptions.queryKey, [localAgent]);

		render(<MachinesSection organizationId="org-one" />, { queryClient, withSuspense: true });

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

		const { queryClient } = render(<MachinesSection organizationId="org-one" />);
		expect(await screen.findByRole("heading", { name: "Archive node" })).toBeTruthy();

		available = false;
		await queryClient.refetchQueries({ queryKey: agentsOptions.queryKey });

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

		render(<MachinesSection organizationId="org-one" />);

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

		render(<MachinesSection organizationId="org-one" />);

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
	render(<MachinesSection organizationId="org-one" />);
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

		render(<MachinesSection organizationId="org-one" />);
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

	render(<MachinesSection organizationId="org-one" />);
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

	render(<MachinesSection organizationId="org-one" />);
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

test.each(["online", "offline"] as const)(
	"warns about insecure HTTP for a remote machine that is %s",
	async (status) => {
		const remote = createAgent({ status, capabilities: { ...emptyCapabilities, connectionSecurity: "insecure" } });
		server.use(http.get("/api/v1/agents", () => HttpResponse.json([localAgent, remote])));

		render(<MachinesSection organizationId="org-one" />);

		expect(await screen.findByText("Insecure HTTP")).toBeTruthy();
		expect(screen.getByText(/Use HTTPS to secure this connection/).textContent).toContain(
			status === "online" ? "Connected without TLS" : "Last connection used HTTP without TLS",
		);
	},
);

test.each(["secure", null] as const)(
	"does not show an insecure warning for connection security %s",
	async (connectionSecurity) => {
		const remote = createAgent({ status: "online", capabilities: { ...emptyCapabilities, connectionSecurity } });
		server.use(http.get("/api/v1/agents", () => HttpResponse.json([localAgent, remote])));

		render(<MachinesSection organizationId="org-one" />);

		await screen.findByRole("heading", { name: "Archive node" });
		expect(screen.queryByText("Insecure HTTP")).toBeNull();
	},
);

const availableUpdate: Agent["update"] = {
	protocolVersion: 2,
	availability: "available",
	delivery: "remote",
	targetTag: "v1.2.3",
	request: null,
};

test("explains a required manual update for an incompatible machine that never became ready", async () => {
	const update: Agent["update"] = {
		...availableUpdate,
		protocolVersion: 1,
		availability: "required",
		delivery: "manual",
	};
	server.use(
		http.get("/api/v1/agents", () =>
			HttpResponse.json([
				{ ...localAgent, update },
				createAgent({ lastSeenAt: 42, update }),
				createAgent({ id: "unused", name: "Unused", update }),
				createAgent({ id: "revoked", name: "Revoked", lastSeenAt: 42, revokedAt: 43, update }),
			]),
		),
	);

	render(<MachinesSection organizationId="org-one" />);

	expect(await screen.findByText("Update required")).toBeTruthy();
	expect(screen.getByText("Backups from this machine are blocked until the agent is updated.")).toBeTruthy();
	expect(screen.getByText("Target version v1.2.3")).toBeTruthy();
	expect(screen.getByRole("link", { name: /How to update/ }).getAttribute("href")).toMatch(
		/remote-agents#manual-updates$/,
	);
	expect(screen.queryByRole("button", { name: /Update agent/ })).toBeNull();
});

test("pins an offline machine's update, blocks duplicate requests, and follows progress through reconnect", async () => {
	let update = availableUpdate;
	const bodies: unknown[] = [];
	const { promise, resolve } = Promise.withResolvers<void>();

	server.use(
		http.get("/api/v1/agents", () => HttpResponse.json([createAgent({ lastSeenAt: 42, update })])),
		http.post("/api/v1/agents/agent-remote/update", async ({ request }) => {
			bodies.push(await request.json());
			await promise;
			update = {
				...update,
				request: {
					id: `request-${bodies.length}`,
					targetTag: "v1.2.3",
					status: "queued",
					requestedAt: 100 * bodies.length,
				},
			};

			return HttpResponse.json(update);
		}),
	);

	const { queryClient } = render(<MachinesSection organizationId="org-one" />);
	expect(await screen.findByText("Update available")).toBeTruthy();
	const trigger = screen.getByRole<HTMLButtonElement>("button", { name: "Update agent for Archive node" });
	trigger.focus();
	await userEvent.keyboard("{Enter}");
	const dialog = screen.getByRole("alertdialog", { name: "Update Archive node?" });
	expect(within(dialog).getByText(/Request agent v1\.2\.3/)).toBeTruthy();

	const confirm = within(dialog).getByRole<HTMLButtonElement>("button", { name: "Queue update" });
	await userEvent.click(confirm);
	expect(confirm.disabled).toBe(true);
	expect(confirm.getAttribute("aria-busy")).toBe("true");
	const cancel = within(dialog).getByRole<HTMLButtonElement>("button", { name: "Cancel" });
	expect(cancel.getAttribute("aria-disabled")).toBe("true");
	expect(document.activeElement).toBe(cancel);

	await userEvent.click(confirm);
	await waitFor(() => expect(bodies).toEqual([{ targetTag: "v1.2.3", credentialVersion: 1 }]));
	await userEvent.click(cancel);
	await userEvent.keyboard("{Escape}");
	expect(screen.getByRole("alertdialog")).toBe(dialog);

	resolve();
	await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
	expect(await screen.findByText(/queued. Waiting for the agent to check in/)).toBeTruthy();
	expect(trigger.disabled).toBe(true);
	await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: "Connect machine" })));

	const request = { id: "request-1", targetTag: "v1.2.3", requestedAt: 100 };
	update = { ...update, request: { ...request, status: "started" } };
	await queryClient.refetchQueries(agentsOptions);
	expect(await screen.findByText(/started. Zerobyte will confirm completion/)).toBeTruthy();
	expect(trigger.disabled).toBe(true);

	update = { ...update, request: { ...request, status: "failed" } };
	await queryClient.refetchQueries(agentsOptions);
	expect(await screen.findByText("Update to v1.2.3 failed.")).toBeTruthy();
	const retry = screen.getByRole<HTMLButtonElement>("button", { name: "Retry update for Archive node" });
	await waitFor(() => expect(retry.disabled).toBe(false));
	await userEvent.click(retry);
	expect(screen.getByRole("alertdialog", { name: "Update Archive node?" })).toBeTruthy();
	await userEvent.keyboard("{Escape}");
	await waitFor(() => expect(document.activeElement).toBe(retry));

	await userEvent.click(retry);
	await userEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Queue update" }));
	expect(await screen.findByText(/queued. Waiting for the agent to check in/)).toBeTruthy();
	expect(bodies).toEqual([
		{ targetTag: "v1.2.3", credentialVersion: 1 },
		{ targetTag: "v1.2.3", credentialVersion: 1 },
	]);

	update = {
		...update,
		availability: "none",
		delivery: null,
		targetTag: null,
		request: { ...request, id: "request-2", status: "completed", requestedAt: 200 },
	};
	await queryClient.refetchQueries(agentsOptions);
	expect(await screen.findByText("Update to v1.2.3 completed. The updated agent reconnected.")).toBeTruthy();
	expect(screen.queryByText("Update available")).toBeNull();
});

test.each([
	{ status: 409, refreshFails: false, nextTag: "v1.2.3" },
	{ status: 409, refreshFails: true, nextTag: "v1.2.4" },
])(
	"handles HTTP $status after loading clears (refresh fails: $refreshFails)",
	async ({ status, refreshFails, nextTag }) => {
		let failRefresh = refreshFails;
		const message = "Update request rejected";
		const bodies: unknown[] = [];
		let updated = false;
		server.use(
			http.get("/api/v1/agents", () => {
				if (updated && failRefresh) return HttpResponse.json({}, { status: 503 });

				const update = { ...availableUpdate, targetTag: updated ? nextTag : availableUpdate.targetTag };
				return HttpResponse.json([createAgent({ lastSeenAt: 42, update })]);
			}),
			http.post("/api/v1/agents/agent-remote/update", async ({ request }) => {
				bodies.push(await request.json());
				updated = true;
				return HttpResponse.json({ message, status: 500 }, { status });
			}),
		);

		const { queryClient } = render(<MachinesSection organizationId="org-one" />);
		await userEvent.click(await screen.findByRole("button", { name: "Update agent for Archive node" }));
		const dialog = screen.getByRole("alertdialog");
		const confirm = within(dialog).getByRole<HTMLButtonElement>("button", { name: "Queue update" });
		await userEvent.click(confirm);

		expect((await within(dialog).findByRole("alert")).textContent).toBe(message);
		await waitFor(() =>
			expect(within(confirm).getByText("Queue update").classList.contains("invisible")).toBe(false),
		);
		expect(confirm.disabled).toBe(true);
		await userEvent.click(confirm);

		expect(bodies).toEqual([{ targetTag: "v1.2.3", credentialVersion: 1 }]);
		if (refreshFails) await screen.findByText("Could not refresh machines");
		failRefresh = false;
		await act(async () => {
			await queryClient.refetchQueries(agentsOptions);
		});
		expect(within(dialog).getByText(/Request agent v1\.2\.3/)).toBeTruthy();
		expect(confirm.disabled).toBe(true);
	},
);

test("an offline browser submission fails once and can be dismissed without submitting on reconnect", async () => {
	const post = vi.fn(() => HttpResponse.error());
	server.use(
		http.get("/api/v1/agents", () => HttpResponse.json([createAgent({ lastSeenAt: 42, update: availableUpdate })])),
		http.post("/api/v1/agents/agent-remote/update", post),
	);

	const { queryClient } = render(<MachinesSection organizationId="org-one" />);
	const trigger = await screen.findByRole("button", { name: "Update agent for Archive node" });
	await userEvent.click(trigger);
	const dialog = screen.getByRole("alertdialog");

	onlineManager.setOnline(false);
	try {
		await userEvent.click(within(dialog).getByRole("button", { name: "Queue update" }));
		expect((await within(dialog).findByRole("alert")).textContent).toMatch(/Could not request an agent update/);
		await userEvent.keyboard("{Escape}");
		await waitFor(() => expect(document.activeElement).toBe(trigger));
	} finally {
		onlineManager.setOnline(true);
	}

	await queryClient.resumePausedMutations();
	expect(post).toHaveBeenCalledTimes(1);
	expect(screen.queryByRole("alertdialog")).toBeNull();
});

test("shows the server error and lets the operator retry a temporarily unavailable update", async () => {
	const message = "Could not verify the release. Try again later.";
	let update = availableUpdate;
	let releaseAvailable = false;
	server.use(
		http.get("/api/v1/agents", () => HttpResponse.json([createAgent({ lastSeenAt: 42, update })])),
		http.post("/api/v1/agents/agent-remote/update", () => {
			if (!releaseAvailable) {
				update = { ...availableUpdate, availability: "none", delivery: null, targetTag: null };
				return HttpResponse.json({ message }, { status: 503 });
			}

			update = {
				...availableUpdate,
				request: { id: "request-1", targetTag: "v1.2.3", requestedAt: 100, status: "queued" },
			};
			return HttpResponse.json(update);
		}),
	);

	render(<MachinesSection organizationId="org-one" />);
	await userEvent.click(await screen.findByRole("button", { name: "Update agent for Archive node" }));
	const dialog = screen.getByRole("alertdialog");
	const confirm = within(dialog).getByRole<HTMLButtonElement>("button", { name: "Queue update" });
	await userEvent.click(confirm);

	await waitFor(() => expect(screen.queryByText("Update available")).toBeNull());
	expect((await within(dialog).findByRole("alert")).textContent).toBe(message);
	await waitFor(() => expect(confirm.disabled).toBe(false));

	releaseAvailable = true;
	await userEvent.click(confirm);
	expect(await screen.findByText(/queued. Waiting for the agent to check in/)).toBeTruthy();
});

test("keeps the cached machines when returning to an organization before its session is active", async () => {
	let activeOrganizationId = "org-one";
	let available = true;
	server.use(
		http.get("/api/v1/agents", ({ request }) => {
			if (!available) return HttpResponse.json({}, { status: 503 });

			const expectedOrganizationId = new URL(request.url).searchParams.get("expectedOrganizationId");
			if (expectedOrganizationId !== activeOrganizationId) {
				return HttpResponse.json({ message: "The active organization changed" }, { status: 409 });
			}

			return HttpResponse.json(activeOrganizationId === "org-one" ? [createAgent()] : [localAgent]);
		}),
	);

	const { queryClient, rerender } = render(<MachinesSection organizationId="org-one" />);
	await screen.findByRole("heading", { name: "Archive node" });

	activeOrganizationId = "org-two";
	rerender(<MachinesSection organizationId="org-two" />);
	await screen.findByText("No remote machines");
	expect(screen.queryByRole("heading", { name: "Archive node" })).toBeNull();

	rerender(<MachinesSection organizationId="org-one" />);
	await screen.findByText("Could not refresh machines");
	expect(screen.getByRole("heading", { name: "Archive node" })).toBeTruthy();

	available = false;
	await act(async () => {
		await queryClient.refetchQueries(agentsOptions);
	});
	expect(screen.getByText("Showing the last known details.")).toBeTruthy();
	expect(screen.getByRole("heading", { name: "Archive node" })).toBeTruthy();
});

test("switches organizations during a slow refresh even when the new organization's request fails", async () => {
	const agentA = createAgent({ lastSeenAt: 42, update: availableUpdate });
	const agentB = createAgent({ organizationId: "org-two", name: "Machine B" });
	const slowRefresh = Promise.withResolvers<void>();
	const refreshStarted = Promise.withResolvers<void>();
	let requests = 0;

	server.use(
		http.get("/api/v1/agents", async () => {
			switch (++requests) {
				case 1:
					return HttpResponse.json([agentA]);
				case 2:
					refreshStarted.resolve();
					await slowRefresh.promise;
					return HttpResponse.json([agentA]);
				case 3:
					return HttpResponse.json({}, { status: 503 });
				default:
					return HttpResponse.json([agentB]);
			}
		}),
	);

	const { queryClient, rerender } = render(<MachinesSection organizationId="org-one" />);
	await userEvent.click(await screen.findByRole("button", { name: "Update agent for Archive node" }));
	expect(screen.getByRole("alertdialog")).toBeTruthy();
	const refresh = queryClient.refetchQueries(agentsOptions);
	await refreshStarted.promise;

	rerender(<MachinesSection organizationId="org-two" />);
	expect(screen.queryByRole("alertdialog")).toBeNull();
	expect(screen.queryByRole("heading", { name: "Archive node" })).toBeNull();
	await screen.findByText("Could not refresh machines");
	slowRefresh.resolve();
	await refresh;

	expect(screen.queryByRole("heading", { name: "Archive node" })).toBeNull();
	expect(screen.queryByRole("heading", { name: "Machine B" })).toBeNull();
	expect(screen.queryByRole("button", { name: /Update agent|Actions for/ })).toBeNull();

	await userEvent.click(screen.getByRole("button", { name: "Retry" }));
	expect(await screen.findByRole("heading", { name: "Machine B" })).toBeTruthy();
	expect(screen.queryByRole("heading", { name: "Archive node" })).toBeNull();
});

test("shows the server error if the target machine is removed and restores focus on close", async () => {
	const agent = createAgent({ lastSeenAt: 42, update: availableUpdate });
	let agents = [agent];
	server.use(
		http.get("/api/v1/agents", () => HttpResponse.json(agents)),
		http.post("/api/v1/agents/agent-remote/update", () =>
			HttpResponse.json({ message: "Remote agent not found" }, { status: 404 }),
		),
	);

	const { queryClient } = render(<MachinesSection organizationId="org-one" />);
	await userEvent.click(await screen.findByRole("button", { name: "Update agent for Archive node" }));
	const dialog = screen.getByRole("alertdialog");

	agents = [];
	await queryClient.refetchQueries(agentsOptions);
	await screen.findByText("No remote machines");
	await userEvent.click(within(dialog).getByRole("button", { name: "Queue update" }));
	expect((await within(dialog).findByRole("alert")).textContent).toBe("Remote agent not found");

	await userEvent.keyboard("{Escape}");
	await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: "Connect machine" })));
});
