import type { Permission } from "~/lib/permission-policy";

export type SettingsScope = "personal" | "organization" | "instance";

type SettingsScopeNavigationItem = {
	title: string;
	scope: SettingsScope;
};

type SettingsSearch = {
	scope?: unknown;
	tab?: unknown;
};

export type SettingsScopeAvailability = {
	organization: boolean;
	instance: boolean;
};

type SettingsPermissionChecker = {
	can: (permission: Permission) => boolean;
};

export const settingsScopeNavigationItems = [
	{ title: "Personal", scope: "personal" },
	{ title: "Organization", scope: "organization" },
	{ title: "Instance", scope: "instance" },
] as const satisfies readonly SettingsScopeNavigationItem[];

export function getSettingsScopeAvailability(permissions: SettingsPermissionChecker): SettingsScopeAvailability {
	const organization =
		permissions.can("organizationSettings.view") ||
		permissions.can("organizationMembers.manage") ||
		permissions.can("sso.manage") ||
		permissions.can("recoveryKey.download");
	const instance = permissions.can("instanceAdministration.view");

	return { organization, instance };
}

export function isSettingsScopeAvailable(scope: SettingsScope, availability: SettingsScopeAvailability) {
	if (scope === "organization") {
		return availability.organization;
	}
	if (scope === "instance") {
		return availability.instance;
	}
	return true;
}

export function getVisibleSettingsScopeNavigationItems(availability: SettingsScopeAvailability) {
	return settingsScopeNavigationItems.filter((item) => isSettingsScopeAvailable(item.scope, availability));
}

export function getActiveSettingsScope(search: SettingsSearch, availability: SettingsScopeAvailability): SettingsScope {
	let requestedScope: SettingsScope = "personal";
	if (search.scope === "organization" || search.scope === "instance" || search.scope === "personal") {
		requestedScope = search.scope;
	} else if (search.tab === "organization") {
		requestedScope = "organization";
	}

	if (!isSettingsScopeAvailable(requestedScope, availability)) {
		return "personal";
	}

	return requestedScope;
}
