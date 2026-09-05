import path from "node:path";
import { homedir } from "node:os";
import type { ResticDeps } from "@zerobyte/core/restic";
import { resolveResticHostname } from "@zerobyte/core/node";

export const resticDeps = (password: string): ResticDeps => {
	const local = process.env.ZEROBYTE_BUILTIN_LOCAL_AGENT === "1";
	const stateDirectory = local ? "/var/lib/zerobyte" : path.join(homedir(), ".cache", "zerobyte-agent");
	const repositoryBase = process.env.ZEROBYTE_REPOSITORIES_DIR || path.join(stateDirectory, "repositories");
	const resticCacheDir = process.env.RESTIC_CACHE_DIR || path.join(stateDirectory, "restic", "cache");
	const resticPassFile = process.env.RESTIC_PASS_FILE || path.join(stateDirectory, "data", "restic.pass");
	const rcloneDirectory = process.env.RCLONE_CONFIG_DIR || "/root/.config/rclone";
	const rcloneConfigFile = path.join(rcloneDirectory, "rclone.conf");
	const resticCommand = (process.env.RESTIC_COMMAND ?? "restic").trim().replace(/^(['"])(.*)\1$/, "$2");
	const credentialFile = process.env.ZEROBYTE_AGENT_CONFIG_PATH;
	const defaultExcludes = [resticPassFile, repositoryBase, resticCacheDir];
	if (credentialFile) defaultExcludes.push(credentialFile);
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
