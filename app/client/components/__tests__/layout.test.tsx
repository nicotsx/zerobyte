import { afterEach, expect, test, vi } from "vitest";
import { PermissionsProvider } from "~/client/hooks/use-permissions";
import { PERMISSION_KEYS, RUNTIME_FEATURE_KEYS, type Permission, type RuntimeFeature } from "~/lib/permission-policy";
import { currentPermissionsQueryKey, type CurrentPermissions } from "~/server/lib/functions/current-permissions";
import { act, cleanup, createTestQueryClient, render, screen, waitFor } from "~/test/test-utils";

const { mockCurrentPermissionsQueryKey } = vi.hoisted(() => ({
	mockCurrentPermissionsQueryKey: ["current-permissions"] as const,
}));

vi.mock("@tanstack/react-router", () => ({
	Link: ({ children, search, to }: { children: string; search: { scope: string }; to: string }) => (
		<a href={`${to}?scope=${search.scope}`}>{children}</a>
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
