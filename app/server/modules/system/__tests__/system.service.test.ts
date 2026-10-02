import { afterAll, afterEach, beforeAll, expect, test } from "vitest";
import { config } from "~/server/core/config";
import { cache, cacheKeys } from "~/server/utils/cache";
import { http, HttpResponse, server } from "~/test/msw/server";
import { systemService } from "../system.service";

const originalAppVersion = config.appVersion;

const release = (tag: string, prerelease = false) => ({
	tag_name: tag,
	prerelease,
	html_url: `https://github.com/nicotsx/zerobyte/releases/tag/${tag}`,
	published_at: "2026-03-26T12:00:00Z",
	body: `Release notes for ${tag}`,
});

const setup = (releases: ReturnType<typeof release>[], currentVersion = "v0.43.0") => {
	config.appVersion = currentVersion;
	cache.del(cacheKeys.system.githubReleases(currentVersion));

	server.use(http.get("https://api.github.com/repos/nicotsx/zerobyte/releases", () => HttpResponse.json(releases)));
};

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));

afterEach(() => {
	cache.del(cacheKeys.system.githubReleases(config.appVersion));
	config.appVersion = originalAppVersion;
	server.resetHandlers();
});

afterAll(() => server.close());

test("ignores a normal semver tag marked as a GitHub prerelease", async () => {
	setup([release("v0.43.1", true), release("v0.43.0")]);

	expect(await systemService.getUpdates()).toEqual({
		currentVersion: "v0.43.0",
		latestVersion: "v0.43.0",
		hasUpdate: false,
		missedReleases: [],
	});
});

test("reports stable updates and release notes when mixed with prereleases", async () => {
	setup([
		release("v0.44.0", true),
		release("v0.43.2"),
		release("v0.43.3", true),
		release("v0.43.1"),
		release("v0.43.0"),
	]);

	expect(await systemService.getUpdates()).toEqual({
		currentVersion: "v0.43.0",
		latestVersion: "v0.43.2",
		hasUpdate: true,
		missedReleases: [
			{
				version: "v0.43.2",
				url: "https://github.com/nicotsx/zerobyte/releases/tag/v0.43.2",
				publishedAt: "2026-03-26T12:00:00Z",
				body: "Release notes for v0.43.2",
			},
			{
				version: "v0.43.1",
				url: "https://github.com/nicotsx/zerobyte/releases/tag/v0.43.1",
				publishedAt: "2026-03-26T12:00:00Z",
				body: "Release notes for v0.43.1",
			},
		],
	});
});

test.each([
	{ scenario: "an empty release list", releases: [] },
	{ scenario: "only prereleases", releases: [release("v0.43.1", true)] },
	{ scenario: "no valid stable version", releases: [release("v0.43.1", true), release("invalid-version")] },
])("falls back to the current version with $scenario", async ({ releases }) => {
	setup(releases);

	expect(await systemService.getUpdates()).toEqual({
		currentVersion: "v0.43.0",
		latestVersion: "v0.43.0",
		hasUpdate: false,
		missedReleases: [],
	});
});

test.each(["dev", "invalid-version"])("does not offer updates for app version %s", async (currentVersion) => {
	setup([release("v0.44.0", true), release("v0.43.1")], currentVersion);

	expect(await systemService.getUpdates()).toEqual({
		currentVersion,
		latestVersion: "v0.43.1",
		hasUpdate: false,
		missedReleases: [],
	});
});
