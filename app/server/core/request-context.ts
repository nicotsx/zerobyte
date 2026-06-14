import { AsyncLocalStorage } from "node:async_hooks";
import {
	evaluatePermission,
	hasRuntimeFeature,
	PERMISSION_KEYS,
	RUNTIME_FEATURE_KEYS,
	type Permission,
	type PermissionContext,
	type PermissionResult,
	type RuntimeFeature,
} from "~/lib/permission-policy";
import { config } from "./config";

export type PermissionSnapshot = {
	permissions: Record<Permission, boolean>;
	features: Record<RuntimeFeature, boolean>;
	permissionResults: Record<Permission, PermissionResult>;
};

type RequestContext = {
	organizationId: string;
	userId?: string;
} & Partial<PermissionContext> &
	Partial<PermissionSnapshot>;

const requestContextStorage = new AsyncLocalStorage<RequestContext>();

export function withContext<T>(context: RequestContext, fn: () => T): T {
	const { instanceRole, orgRole, authSource, ...baseContext } = context;
	const nextContext = { ...baseContext, ...resolvePermissions({ instanceRole, orgRole, authSource }) };
	return requestContextStorage.run(nextContext, fn);
}

export function resolvePermissions(context: PermissionContext): PermissionSnapshot {
	const permissionResults = {} as Record<Permission, PermissionResult>;
	const permissions = {} as Record<Permission, boolean>;
	for (const permission of PERMISSION_KEYS) {
		const result = evaluatePermission(permission, { ...context, runtime: config.runtime });
		permissionResults[permission] = result;
		permissions[permission] = result.allowed;
	}

	const features = {} as Record<RuntimeFeature, boolean>;
	for (const feature of RUNTIME_FEATURE_KEYS) {
		features[feature] = hasRuntimeFeature(config.runtime, feature);
	}

	return { permissions, features, permissionResults };
}

const getRequestContext = (): RequestContext => {
	const context = requestContextStorage.getStore();

	if (!context?.organizationId) {
		throw new Error("Organization context is missing");
	}

	return context;
};

export const getOrganizationId = () => getRequestContext().organizationId;

const getPermissionSnapshot = (): PermissionSnapshot => {
	const context = getRequestContext();

	if (!context.permissions || !context.features || !context.permissionResults) {
		throw new Error("Permission context is missing");
	}

	return {
		permissions: context.permissions,
		features: context.features,
		permissionResults: context.permissionResults,
	};
};

export const getPermission = (permission: Permission) => getPermissionSnapshot().permissionResults[permission];
export const can = (permission: Permission) => getPermissionSnapshot().permissions[permission];
export const hasFeature = (feature: RuntimeFeature) => getPermissionSnapshot().features[feature];
