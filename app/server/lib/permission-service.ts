import { RUNTIME_FEATURES, type RuntimeFeature } from "~/lib/permission-policy";
import { config } from "~/server/core/config";

export const getInstanceFeatures = (): Record<RuntimeFeature, boolean> => {
	const runtimeFeatures = RUNTIME_FEATURES[config.runtime];

	return { ...runtimeFeatures, remoteAgents: runtimeFeatures.remoteAgents && config.flags.enableRemoteAgents };
};

export function serverHasRuntimeFeature(feature: RuntimeFeature) {
	return getInstanceFeatures()[feature];
}
