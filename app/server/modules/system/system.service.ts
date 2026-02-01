import { getCapabilities } from "../../core/capabilities";
import { config } from "../../core/config";
import type { UpdateInfoDto } from "./system.dto";
import semver from "semver";
import { cache } from "../../utils/cache";
import { logger } from "~/server/utils/logger";
import { db } from "../../db/db";
import { appMetadataTable } from "../../db/schema";
import { REGISTRATION_ENABLED_KEY } from "~/client/lib/constants";

const CACHE_TTL = 60 * 60;

const getSystemInfo = async () => {
	return {
		capabilities: await getCapabilities(),
	};
};

interface GitHubRelease {
	tag_name: string;
	html_url: string;
	published_at: string;
	body: string;
}

const getUpdates = async (): Promise<UpdateInfoDto> => {
	const CACHE_KEY = `system:updates:${config.appVersion}`;

	const cached = cache.get<UpdateInfoDto>(CACHE_KEY);
	if (cached) {
		return cached;
	}

	try {
		const controller = new AbortController();
		const timeoutId = setTimeout(() => controller.abort(), 5000);

		const response = await fetch("https://api.github.com/repos/nicotsx/zerobyte/releases", {
			signal: controller.signal,
			headers: {
				"User-Agent": "zerobyte-app",
			},
		});
		clearTimeout(timeoutId);

		if (!response.ok) {
			throw new Error(`GitHub API returned ${response.status}`);
		}

		const releases = (await response.json()) as GitHubRelease[];
		const currentVersion = config.appVersion;

		const formattedReleases = releases.map((r) => ({
			version: r.tag_name,
			url: r.html_url,
			publishedAt: r.published_at,
			body: r.body,
		}));

		const latestRelease = formattedReleases[0];
		const latestVersion = latestRelease?.version ?? currentVersion;

		const hasUpdate = !!(
			currentVersion !== "dev" &&
			semver.valid(currentVersion) &&
			semver.valid(latestVersion) &&
			semver.gt(latestVersion, currentVersion)
		);

		const missedReleases =
			currentVersion === "dev" || !semver.valid(currentVersion)
				? []
				: formattedReleases.filter((r) => !!(semver.valid(r.version) && semver.gt(r.version, currentVersion)));

		const data = { currentVersion, latestVersion, hasUpdate, missedReleases };

		cache.set(CACHE_KEY, data, CACHE_TTL);

		return data;
	} catch (error) {
		logger.error("Failed to fetch updates from GitHub:", error);
		return {
			currentVersion: config.appVersion,
			latestVersion: config.appVersion,
			hasUpdate: false,
			missedReleases: [],
		};
	}
};

const isRegistrationEnabled = async () => {
	const result = await db.query.appMetadataTable.findFirst({
		where: { key: REGISTRATION_ENABLED_KEY },
	});

	return result?.value === "true";
};

const setRegistrationEnabled = async (enabled: boolean) => {
	const now = Date.now();

	await db
		.insert(appMetadataTable)
		.values({ key: REGISTRATION_ENABLED_KEY, value: JSON.stringify(enabled), createdAt: now, updatedAt: now })
		.onConflictDoUpdate({ target: appMetadataTable.key, set: { value: JSON.stringify(enabled), updatedAt: now } });

	logger.info(`Registration enabled set to: ${enabled}`);
};

export const systemService = {
	getSystemInfo,
	getUpdates,
	isRegistrationEnabled,
	setRegistrationEnabled,
};
