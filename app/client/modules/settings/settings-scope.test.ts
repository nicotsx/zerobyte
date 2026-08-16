import { describe, expect, test } from "vitest";
import type { Permission } from "~/lib/permission-policy";
import {
	getActiveSettingsScope,
	getSettingsScopeAvailability,
	getVisibleSettingsScopeNavigationItems,
} from "./settings-scope";

const allPermissions = [
	"organizationSettings.view",
	"organizationMembers.manage",
	"sso.manage",
	"recoveryKey.download",
	"instanceAdministration.view",
] as const satisfies readonly Permission[];

function getAvailability(grantedPermissions: readonly (typeof allPermissions)[number][]) {
	const permissions = new Set<Permission>(grantedPermissions);

	return getSettingsScopeAvailability({
		can: (permission) => permissions.has(permission),
	});
}

describe("settings scope navigation", () => {
	test("makes organization available for every permission that exposes organization settings", () => {
		for (const permission of allPermissions.slice(0, -1)) {
			const availability = getAvailability([permission]);

			expect(availability.organization).toBe(true);
			expect(getActiveSettingsScope({ scope: "organization" }, availability)).toBe("organization");
		}
	});

	test("uses the same availability policy for visible and active scopes", () => {
		const availability = getAvailability([]);
		const visibleScopes = getVisibleSettingsScopeNavigationItems(availability).map((item) => item.scope);
		const activeOrganizationScope = getActiveSettingsScope({ scope: "organization" }, availability);
		const activeInstanceScope = getActiveSettingsScope({ scope: "instance" }, availability);

		expect(visibleScopes).toEqual(["personal"]);
		expect(activeOrganizationScope).toBe("personal");
		expect(activeInstanceScope).toBe("personal");
	});

	test("makes instance visible and active only with instance administration access", () => {
		const availability = getAvailability(["instanceAdministration.view"]);
		const visibleScopes = getVisibleSettingsScopeNavigationItems(availability).map((item) => item.scope);
		const activeScope = getActiveSettingsScope({ scope: "instance" }, availability);

		expect(visibleScopes).toEqual(["personal", "instance"]);
		expect(activeScope).toBe("instance");
	});
});
