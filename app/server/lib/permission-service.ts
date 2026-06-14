import { hasRuntimeFeature as hasRuntimeFeatureWithRuntime, type RuntimeFeature } from "~/lib/permission-policy";
import { config } from "~/server/core/config";

export function serverHasRuntimeFeature(feature: RuntimeFeature) {
	return hasRuntimeFeatureWithRuntime(config.runtime, feature);
}
