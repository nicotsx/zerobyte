import { fromPartial } from "@total-typescript/shoehorn";
import { afterEach, expect, test, vi } from "vitest";
import { PermissionsProvider } from "~/client/hooks/use-permissions";
import {
	PERMISSION_KEYS,
	RUNTIME_FEATURE_KEYS,
	evaluatePermission,
	hasRuntimeFeature,
	type PermissionPolicyContext,
} from "~/lib/permission-policy";
import { currentPermissionsQueryKey, type CurrentPermissions } from "~/server/lib/functions/current-permissions";
import { cleanup, createTestQueryClient, render, screen } from "~/test/test-utils";

const { mockCurrentPermissionsQueryKey, mockSearch } = vi.hoisted(() => ({
	mockCurrentPermissionsQueryKey: ["current-permissions"] as const,
	mockSearch: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({
	useNavigate: () => vi.fn(),
	useSearch: mockSearch,
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

import { SettingsShell } from "../settings-shell";
import { TooltipProvider } from "~/client/components/ui/tooltip";
import { getSystemInfoQueryKey, getApiKeysQueryKey } from "~/client/api-client/@tanstack/react-query.gen";

afterEach(() => {
	cleanup();
});

test.each([
	{ runtime: "desktop", scope: "personal" },
	{ runtime: "desktop", scope: "organization" },
	{ runtime: "desktop", scope: "instance" },
	{ runtime: "server", scope: "personal" },
] as const)("shows the appropriate $runtime settings for the $scope scope", ({ runtime, scope }) => {
	mockSearch.mockReturnValue({ scope });
	const authSource = runtime === "desktop" ? "desktop-session" : "browser-session";
	const passwordAuthSupported = runtime === "server";
	const ownerContext: PermissionPolicyContext = {
		runtime,
		instanceRole: null,
		orgRole: "owner",
		authSource,
	};
	const permissionEntries = PERMISSION_KEYS.map((permission) => {
		const permissionResult = evaluatePermission(permission, ownerContext);

		return [permission, permissionResult.allowed];
	});
	const permissions = Object.fromEntries(permissionEntries) as CurrentPermissions["permissions"];
	const featureEntries = RUNTIME_FEATURE_KEYS.map((feature) => [feature, hasRuntimeFeature(runtime, feature)]);
	const features = Object.fromEntries(featureEntries) as CurrentPermissions["features"];
	const activeOrganizationId = null;
	const currentPermissions: CurrentPermissions = { activeOrganizationId, permissions, features };
	const queryClient = createTestQueryClient();
	queryClient.setQueryDefaults([], { staleTime: Infinity });
	queryClient.setQueryData(currentPermissionsQueryKey, currentPermissions);
	queryClient.setQueryData(getSystemInfoQueryKey(), { runtime });
	queryClient.setQueryData(getApiKeysQueryKey(), { apiKeys: [] });
	queryClient.setQueryData(["passkeys"], []);

	render(
		<TooltipProvider>
			<PermissionsProvider>
				<SettingsShell
					appContext={{
						user: fromPartial({
							hasPassword: true,
							username: "desktop-admin",
							email: "desktop@zerobyte.local",
						}),
						passwordAuthSupported,
						hasUsers: true,
						hasSkippedRecoveryKeyDownload: false,
					}}
					initialUserInvitations={[]}
				/>
			</PermissionsProvider>
		</TooltipProvider>,
		{ queryClient, withSuspense: true },
	);

	if (runtime === "server") {
		expect(screen.getByLabelText("Username")).toBeTruthy();
		expect(screen.getByLabelText("Current Password")).toBeTruthy();
		expect(screen.getByLabelText("Date format")).toBeTruthy();
		expect(screen.getByText("Passkeys")).toBeTruthy();
		expect(screen.queryByRole("button", { name: "Download recovery key" })).toBeNull();
		return;
	}
	expect(screen.getByRole("button", { name: "Download recovery key" })).toBeTruthy();
	expect(screen.getByRole("button", { name: "Export encrypted config" })).toBeTruthy();
	expect(screen.getByLabelText("Date format")).toBeTruthy();
	expect(screen.getByLabelText("Time format")).toBeTruthy();
	expect(screen.queryByLabelText("Username")).toBeNull();
	expect(screen.queryByLabelText("Email")).toBeNull();
	expect(screen.queryByLabelText("Current Password")).toBeNull();
	expect(screen.queryByText("Two-Factor Authentication")).toBeNull();
	expect(screen.queryByText("Passkeys")).toBeNull();
	expect(screen.queryByText("Organization Details")).toBeNull();
});
