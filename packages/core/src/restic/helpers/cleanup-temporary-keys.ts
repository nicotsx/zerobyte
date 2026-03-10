import fs from "node:fs/promises";
import type { ResticDeps, ResticEnv } from "../types";

export const cleanupTemporaryKeys = async (env: ResticEnv, deps: ResticDeps) => {
	const keysToClean = ["_SFTP_KEY_PATH", "_SFTP_KNOWN_HOSTS_PATH", "RESTIC_CACERT", "GOOGLE_APPLICATION_CREDENTIALS"];

	for (const key of keysToClean) {
		if (env[key]) {
			await fs.unlink(env[key]).catch(() => {});
		}
	}

	if (env.RESTIC_PASSWORD_FILE && env.RESTIC_PASSWORD_FILE !== deps.resticPassFile) {
		await fs.unlink(env.RESTIC_PASSWORD_FILE).catch(() => {});
	}
};
