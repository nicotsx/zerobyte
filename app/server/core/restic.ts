import { createRestic } from "@zerobyte/core/restic/server";
import type { ResticDeps } from "@zerobyte/core/restic";
import { DEFAULT_EXCLUDES, RCLONE_CONFIG_FILE, RESTIC_CACHE_DIR, RESTIC_PASS_FILE } from "./constants";
import { config } from "./config";
import { cryptoUtils } from "../utils/crypto";
import { db } from "../db/db";

export const resticDeps: ResticDeps = {
	resolveSecret: cryptoUtils.resolveSecret,
	getOrganizationResticPassword: async (organizationId: string) => {
		const org = await db.query.organization.findFirst({
			where: { id: organizationId },
		});

		if (!org) {
			throw new Error(`Organization ${organizationId} not found`);
		}

		const metadata = org.metadata as { resticPassword?: string } | null;
		if (!metadata?.resticPassword) {
			throw new Error(`Restic password not configured for organization ${organizationId}`);
		}

		return metadata.resticPassword;
	},
	resticCacheDir: RESTIC_CACHE_DIR,
	resticPassFile: RESTIC_PASS_FILE,
	defaultExcludes: DEFAULT_EXCLUDES,
	rcloneConfigFile: RCLONE_CONFIG_FILE,
	hostname: config.resticHostname,
};

export const restic = createRestic(resticDeps);
