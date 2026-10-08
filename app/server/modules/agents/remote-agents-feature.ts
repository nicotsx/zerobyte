import { ServiceUnavailableError } from "http-errors-enhanced";
import { config } from "../../core/config";

export const REMOTE_AGENTS_UNAVAILABLE = "Remote agents are disabled on this instance.";

export const isRemoteAgentsEnabled = () => config.runtime === "server" && config.flags.enableRemoteAgents;

export const assertRemoteAgentsEnabled = () => {
	if (!isRemoteAgentsEnabled()) {
		throw new ServiceUnavailableError(REMOTE_AGENTS_UNAVAILABLE);
	}
};
