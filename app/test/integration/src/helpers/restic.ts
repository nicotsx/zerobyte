import path from "node:path";
import { createRestic } from "@zerobyte/core/restic/server";
import { RCLONE_CONFIG_FILE } from "../constants";

export const createIntegrationRestic = (workspace: string, resticPassword: string) => {
	return createRestic({
		resolveSecret: async (value: string) => value,
		getOrganizationResticPassword: async () => resticPassword,
		resticCacheDir: path.join(workspace, "restic-cache"),
		resticPassFile: path.join(workspace, "restic.pass"),
		defaultExcludes: [],
		rcloneConfigFile: RCLONE_CONFIG_FILE,
	});
};
