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

const { mockCurrentPermissionsQueryKey } = vi.hoisted(() => ({
	mockCurrentPermissionsQueryKey: ["current-permissions"] as const,
}));

vi.mock("@tanstack/react-router", () => ({
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

import { SettingsPage } from "./settings";

afterEach(() => {
	cleanup();
});

test("shows recovery key and configuration export when recovery-key access is granted without organization settings access", () => {
	const desktopOwnerContext: PermissionPolicyContext = {
		runtime: "desktop",
		instanceRole: null,
		orgRole: "owner",
		authSource: "desktop-session",
	};
	const permissionEntries = PERMISSION_KEYS.map((permission) => {
		const permissionResult = evaluatePermission(permission, desktopOwnerContext);

		return [permission, permissionResult.allowed];
	});
	const permissions = Object.fromEntries(permissionEntries) as CurrentPermissions["permissions"];
	const featureEntries = RUNTIME_FEATURE_KEYS.map((feature) => [feature, hasRuntimeFeature("desktop", feature)]);
	const features = Object.fromEntries(featureEntries) as CurrentPermissions["features"];
	const currentPermissions: CurrentPermissions = { permissions, features };
	const queryClient = createTestQueryClient();
	queryClient.setQueryDefaults(currentPermissionsQueryKey, { staleTime: Infinity });
	queryClient.setQueryData(currentPermissionsQueryKey, currentPermissions);

	render(
		<PermissionsProvider>
			<SettingsPage
				activeScope="organization"
				appContext={{
					user: null,
					passwordAuthSupported: false,
					hasUsers: true,
					hasSkippedRecoveryKeyDownload: false,
				}}
				initialUserInvitations={[]}
			/>
		</PermissionsProvider>,
		{ queryClient, withSuspense: true },
	);

	expect(screen.getByRole("button", { name: "Download recovery key" })).toBeTruthy();
	expect(screen.getByRole("button", { name: "Export encrypted config" })).toBeTruthy();
	expect(screen.queryByRole("heading", { name: "Organization Details" })).toBeNull();
});
