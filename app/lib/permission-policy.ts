export type Runtime = "server" | "desktop";
export type AuthSource = "browser-session" | "api-key";

export type RuntimeFeature =
	| "instanceAdministration"
	| "organizationAdministration"
	| "ssoManagement"
	| "remoteVolumeBackends";

export const RUNTIME_FEATURES = {
	server: {
		instanceAdministration: true,
		organizationAdministration: true,
		ssoManagement: true,
		remoteVolumeBackends: true,
	},
	desktop: {
		instanceAdministration: false,
		organizationAdministration: false,
		ssoManagement: false,
		remoteVolumeBackends: false,
	},
} as const satisfies Record<Runtime, Record<RuntimeFeature, boolean>>;

type PermissionPolicy = {
	feature?: RuntimeFeature;
	instanceRoles?: readonly string[];
	orgRoles?: readonly string[];
	authSources?: readonly AuthSource[];
};

const PERMISSIONS = {
	"instanceAdministration.view": {
		feature: "instanceAdministration",
		instanceRoles: ["admin"],
		authSources: ["browser-session"],
	},
	"instanceUsers.manage": {
		feature: "instanceAdministration",
		instanceRoles: ["admin"],
		authSources: ["browser-session"],
	},
	"registration.manage": {
		feature: "instanceAdministration",
		instanceRoles: ["admin"],
		authSources: ["browser-session"],
	},
	"organizationSettings.view": {
		feature: "organizationAdministration",
		orgRoles: ["owner", "admin"],
	},
	"organizationMembers.manage": {
		feature: "organizationAdministration",
		orgRoles: ["owner", "admin"],
	},
	"sso.manage": {
		feature: "ssoManagement",
		orgRoles: ["owner", "admin"],
		authSources: ["browser-session"],
	},
	"ssoProvider.create": {
		feature: "ssoManagement",
		orgRoles: ["owner"],
		authSources: ["browser-session"],
	},
	"recoveryKey.download": {
		orgRoles: ["owner", "admin"],
		authSources: ["browser-session"],
	},
} as const satisfies Record<string, PermissionPolicy>;

export type Permission = keyof typeof PERMISSIONS;
export const PERMISSION_KEYS = Object.keys(PERMISSIONS) as Permission[];
export const RUNTIME_FEATURE_KEYS = Object.keys(RUNTIME_FEATURES.server) as RuntimeFeature[];

export type PermissionContext = {
	instanceRole?: string | null;
	orgRole?: string | null;
	authSource?: AuthSource | null;
};

export type PermissionPolicyContext = PermissionContext & {
	runtime: Runtime;
};

export type PermissionDenyReason = "runtime" | "authSource" | "instanceRole" | "orgRole";

export type PermissionResult = { allowed: true } | { allowed: false; reason: PermissionDenyReason };

export function hasRuntimeFeature(runtime: Runtime, feature: RuntimeFeature) {
	return RUNTIME_FEATURES[runtime][feature];
}

const includesValue = (values: readonly string[] | undefined, value: string | null | undefined) => {
	return values?.includes(value ?? "") ?? true;
};

export function evaluatePermission(permission: Permission, context: PermissionPolicyContext): PermissionResult {
	const policy: PermissionPolicy = PERMISSIONS[permission];

	if (policy.feature && !hasRuntimeFeature(context.runtime, policy.feature)) {
		return { allowed: false, reason: "runtime" };
	}

	if (!includesValue(policy.authSources, context.authSource)) {
		return { allowed: false, reason: "authSource" };
	}

	if (!includesValue(policy.instanceRoles, context.instanceRole)) {
		return { allowed: false, reason: "instanceRole" };
	}

	if (!includesValue(policy.orgRoles, context.orgRole)) {
		return { allowed: false, reason: "orgRole" };
	}

	return { allowed: true };
}
