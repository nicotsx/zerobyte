import path from "node:path";
import type { ResticDeps } from "@zerobyte/core/restic";
import { resolveResticHostname } from "./hostname";

const REPOSITORY_BASE = process.env.ZEROBYTE_REPOSITORIES_DIR || "/var/lib/zerobyte/repositories";
const RESTIC_CACHE_DIR = process.env.RESTIC_CACHE_DIR || "/var/lib/zerobyte/restic/cache";
const RESTIC_PASS_FILE = process.env.RESTIC_PASS_FILE || "/var/lib/zerobyte/data/restic.pass";
const RCLONE_CONFIG_DIR = process.env.RCLONE_CONFIG_DIR || "/root/.config/rclone";
const RCLONE_CONFIG_FILE = path.join(RCLONE_CONFIG_DIR, "rclone.conf");
const DEFAULT_EXCLUDES = [RESTIC_PASS_FILE, REPOSITORY_BASE];

export const resticDeps = (password: string): ResticDeps => ({
	resolveSecret: async (encrypted) => encrypted,
	getOrganizationResticPassword: async () => password,
	resticCacheDir: RESTIC_CACHE_DIR,
	resticPassFile: RESTIC_PASS_FILE,
	defaultExcludes: DEFAULT_EXCLUDES,
	hostname: resolveResticHostname(),
	rcloneConfigFile: RCLONE_CONFIG_FILE,
});
