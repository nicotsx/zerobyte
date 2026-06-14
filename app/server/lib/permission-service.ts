import {
	evaluatePermission,
	hasRuntimeFeature as hasRuntimeFeatureWithRuntime,
	type Permission,
	type PermissionContext,
	type RuntimeFeature,
} from "~/lib/permission-policy";
import { config } from "~/server/core/config";

export type { Permission, PermissionContext, PermissionResult } from "~/lib/permission-policy";

export function checkPermissionForContext(permission: Permission, context: PermissionContext) {
	return evaluatePermission(permission, { ...context, runtime: config.runtime });
}

export function serverHasRuntimeFeature(feature: RuntimeFeature) {
	return hasRuntimeFeatureWithRuntime(config.runtime, feature);
}
