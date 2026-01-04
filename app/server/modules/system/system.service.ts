import { getCapabilities } from "../../core/capabilities";
import { config } from "../../core/config";
import type { UpdateInfoDto } from "./system.dto";
import semver from "semver";

let updateCache: {
	data: UpdateInfoDto;
	timestamp: number;
} | null = null;

const CACHE_TTL = 60 * 60 * 1000; // 1 hour

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
	const now = Date.now();
	if (updateCache && now - updateCache.timestamp < CACHE_TTL) {
		return updateCache.data;
	}

	try {
		const response = await fetch("https://api.github.com/repos/nicotsx/zerobyte/releases", {
			headers: {
				"User-Agent": "zerobyte-app",
			},
		});

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

		const data: UpdateInfoDto = {
			currentVersion,
			latestVersion,
			hasUpdate,
			missedReleases,
		};

		updateCache = {
			data,
			timestamp: now,
		};

		return data;
	} catch (error) {
		console.error("Failed to fetch updates from GitHub:", error);
		return {
			currentVersion: config.appVersion,
			latestVersion: config.appVersion,
			hasUpdate: false,
			missedReleases: [],
		};
	}
};

export const systemService = {
	getSystemInfo,
	getUpdates,
};
