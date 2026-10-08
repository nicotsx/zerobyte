import path from "node:path";
import { homedir } from "node:os";
import type { ResticDeps } from "@zerobyte/core/restic";
import { resolveResticHostname } from "@zerobyte/core/node";
import { unquote } from "@zerobyte/core/utils";

export const resticDeps = (password: string): ResticDeps => {
	const local = process.env.ZEROBYTE_BUILTIN_LOCAL_AGENT === "1";
	const stateDirectory = local ? "/var/lib/zerobyte" : path.join(homedir(), ".cache", "zerobyte-agent");
	const repositoryBase = process.env.ZEROBYTE_REPOSITORIES_DIR || path.join(stateDirectory, "repositories");
	const resticCacheDir = process.env.RESTIC_CACHE_DIR || path.join(stateDirectory, "restic", "cache");
	const resticPassFile = process.env.RESTIC_PASS_FILE || path.join(stateDirectory, "data", "restic.pass");
	const rcloneDirectory = process.env.RCLONE_CONFIG_DIR || "/root/.config/rclone";
	const rcloneConfigFile = path.join(rcloneDirectory, "rclone.conf");
	const resticCommand = unquote(process.env.RESTIC_COMMAND ?? "restic");

	const defaultExcludes = [resticPassFile, repositoryBase, resticCacheDir];

	return {
		resolveSecret: async (encrypted) => encrypted,
		getOrganizationResticPassword: async () => password,
		resticCacheDir,
		resticPassFile,
		defaultExcludes,
		hostname: resolveResticHostname(),
		rcloneConfigFile,
		resticCommand,
	};
};
