import { afterEach, expect, test, vi } from "vitest";
import type { ListAgentsResponse } from "~/client/api-client/types.gen";
import { PermissionsProvider } from "~/client/hooks/use-permissions";
import { PERMISSION_KEYS, RUNTIME_FEATURE_KEYS, type Permission, type RuntimeFeature } from "~/lib/permission-policy";
import { currentPermissionsQueryKey, type CurrentPermissions } from "~/server/lib/functions/current-permissions";
import { HttpResponse, http, server } from "~/test/msw/server";
import { act, cleanup, createTestQueryClient, render, screen, waitFor } from "~/test/test-utils";

const { mockCurrentPermissionsQueryKey } = vi.hoisted(() => ({
	mockCurrentPermissionsQueryKey: ["current-permissions"] as const,
}));

vi.mock("@tanstack/react-router", () => ({
	Link: ({
		children,
		hash,
		search,
		to,
		...props
	}: {
		children: React.ReactNode;
		hash?: string;
		search: { scope: string };
		to: string;
	}) => (
		<a href={`${to}?scope=${search.scope}${hash ? `#${hash}` : ""}`} {...props}>
			{children}
		</a>
	),
	Outlet: () => null,
	useNavigate: () => vi.fn(),
}));

vi.mock("~/server/lib/functions/current-permissions", () => ({
	currentPermissionsQueryKey: mockCurrentPermissionsQueryKey,
	getCurrentPermissions: vi.fn(),
	getCurrentPermissionsOptions: (queryFn: () => Promise<unknown>) => ({
		queryKey: mockCurrentPermissionsQueryKey,
		queryFn,
	}),
}));

vi.mock("~/server/lib/functions/organization-context", () => ({
	getOrganizationContext: vi.fn(),
}));

import { DashboardAgentUpdates } from "../dashboard-agent-updates";
import { DashboardRecoveryKeyReminder } from "../layout";

const activeOrganization = {
	id: "organization-one",
	createdAt: new Date("2025-01-01T00:00:00.000Z"),
	recoveryKeyExportedAt: null,
};

const createCurrentPermissions = (activeOrganizationId: string): CurrentPermissions => {
	const permissions = Object.fromEntries(
		PERMISSION_KEYS.map((permission) => [permission, permission === "recoveryKey.download"]),
	) as Record<Permission, boolean>;
	const features = Object.fromEntries(RUNTIME_FEATURE_KEYS.map((feature) => [feature, false])) as Record<
		RuntimeFeature,
		boolean
	>;

	return { activeOrganizationId, permissions, features };
};

afterEach(() => {
	cleanup();
});

test("hides the reminder until permission refetch matches the switched organization", async () => {
	const queryClient = createTestQueryClient();
	queryClient.setQueryDefaults(currentPermissionsQueryKey, { staleTime: Infinity });
	queryClient.setQueryDefaults(["organization-context"], { staleTime: Infinity });
	queryClient.setQueryData(currentPermissionsQueryKey, createCurrentPermissions("organization-one"));
	queryClient.setQueryData(["organization-context"], {
		organizations: [activeOrganization],
		activeOrganization,
		activeMember: null,
	});

	render(
		<PermissionsProvider>
			<DashboardRecoveryKeyReminder />
		</PermissionsProvider>,
		{ queryClient, withSuspense: true },
	);

	expect(screen.getByRole("region", { name: "Recovery key reminder" })).toBeTruthy();

	const switchedOrganization = { ...activeOrganization, id: "organization-two" };
	act(() => {
		queryClient.setQueryData(["organization-context"], {
			organizations: [switchedOrganization],
			activeOrganization: switchedOrganization,
			activeMember: null,
		});
	});

	await waitFor(() => expect(screen.queryByRole("region", { name: "Recovery key reminder" })).toBeNull());

	act(() => {
		queryClient.setQueryData(currentPermissionsQueryKey, createCurrentPermissions("organization-two"));
	});

	await waitFor(() => expect(screen.getByRole("region", { name: "Recovery key reminder" })).toBeTruthy());
});

const updatableAgent: ListAgentsResponse[number] = {
	id: "remote",
	organizationId: activeOrganization.id,
	name: "Remote",
	kind: "remote",
	status: "offline",
	capabilities: {
		hostname: null,
		platform: null,
		agentVersion: null,
		resticVersion: null,
		connectionSecurity: null,
		trustedRoots: [],
	},
	update: { protocolVersion: 1, availability: "required", delivery: "manual", targetTag: "v1.2.3", request: null },
	lastSeenAt: 10,
	lastReadyAt: null,
	createdAt: 1,
	updatedAt: 10,
	revokedAt: null,
	credentialVersion: 1,
};

test.each([
	{ canManage: true, hasFeature: true, permissionsMatch: true, expectedRequests: 1 },
	{ canManage: false, hasFeature: true, permissionsMatch: true, expectedRequests: 0 },
	{ canManage: true, hasFeature: false, permissionsMatch: true, expectedRequests: 0 },
	{ canManage: true, hasFeature: true, permissionsMatch: false, expectedRequests: 0 },
])(
	"shows the current organization's update count only when permitted ($canManage, $hasFeature, $permissionsMatch)",
	async ({ canManage, hasFeature, permissionsMatch, expectedRequests }) => {
		const permissions = createCurrentPermissions(
			permissionsMatch ? activeOrganization.id : "previous-organization",
		);
		permissions.permissions["agents.manage"] = canManage;
		permissions.features.remoteAgents = hasFeature;

		const queryClient = createTestQueryClient();
		queryClient.setQueryDefaults(currentPermissionsQueryKey, { staleTime: Infinity });
		queryClient.setQueryDefaults(["organization-context"], { staleTime: Infinity });
		queryClient.setQueryData(currentPermissionsQueryKey, permissions);
		queryClient.setQueryData(["organization-context"], {
			organizations: [activeOrganization],
			activeOrganization,
			activeMember: null,
		});

		const agents: ListAgentsResponse = [
			updatableAgent,
			{ ...updatableAgent, id: "optional", update: { ...updatableAgent.update, availability: "available" } },
			{ ...updatableAgent, id: "revoked", revokedAt: 42 },
			{ ...updatableAgent, id: "unused", lastSeenAt: null },
			{ ...updatableAgent, id: "local", kind: "local" },
			{ ...updatableAgent, id: "current", update: { ...updatableAgent.update, availability: "none" } },
		];
		const request = vi.fn(({ request }: { request: Request }) => {
			expect(new URL(request.url).searchParams.get("expectedOrganizationId")).toBe(activeOrganization.id);
			return HttpResponse.json(agents);
		});
		server.use(http.get("/api/v1/agents", request));

		render(
			<PermissionsProvider>
				<DashboardAgentUpdates />
			</PermissionsProvider>,
			{ queryClient, withSuspense: true },
		);

		if (expectedRequests) {
			const link = await screen.findByRole("link", { name: /2 agent updates.*1 required and 1 optional/ });
			expect(link.getAttribute("href")).toBe("/settings?scope=organization#machines");
		} else {
			expect(screen.queryByRole("link", { name: /agent update/ })).toBeNull();
		}
		expect(request).toHaveBeenCalledTimes(expectedRequests);
	},
);
