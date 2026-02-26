import fs from "node:fs/promises";
import { RESTIC_PASS_FILE } from "~/server/core/constants";
import type { ResticEnv } from "../types";

export const cleanupTemporaryKeys = async (env: ResticEnv) => {
	const keysToClean = ["_SFTP_KEY_PATH", "_SFTP_KNOWN_HOSTS_PATH", "RESTIC_CACERT", "GOOGLE_APPLICATION_CREDENTIALS"];

	for (const key of keysToClean) {
		if (env[key]) {
			await fs.unlink(env[key]).catch(() => {});
		}
	}

	if (env.RESTIC_PASSWORD_FILE && env.RESTIC_PASSWORD_FILE !== RESTIC_PASS_FILE) {
		await fs.unlink(env.RESTIC_PASSWORD_FILE).catch(() => {});
	}
};
