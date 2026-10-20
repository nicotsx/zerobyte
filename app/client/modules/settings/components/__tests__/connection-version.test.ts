import { beforeEach, expect, test, vi } from "vitest";

const version = vi.hoisted(() => ({ value: "dev" }));

vi.mock("~/client/lib/version", () => ({
	get APP_VERSION() {
		return version.value;
	},
}));

beforeEach(() => {
	vi.resetModules();
});

test.each([
	{ appVersion: "v1.2.3", imageTag: "v1.2.3", nativeRelease: "v1.2.3" },
	{ appVersion: "v1.2.3-alpha.1", imageTag: "v1.2.3-alpha.1", nativeRelease: "v1.2.3-alpha.1" },
	{ appVersion: "v1.2.3-beta.1", imageTag: "v1.2.3-beta.1", nativeRelease: "v1.2.3-beta.1" },
	{ appVersion: "nightly", imageTag: "nightly", nativeRelease: "latest" },
	{
		appVersion: "sha-0123456789abcdef0123456789abcdef01234567",
		imageTag: "sha-0123456789abcdef0123456789abcdef01234567",
		nativeRelease: "latest",
	},
	{ appVersion: "dev", imageTag: "latest", nativeRelease: "latest" },
	{ appVersion: "sha-0123456", imageTag: "latest", nativeRelease: "latest" },
	{ appVersion: "sha-zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz", imageTag: "latest", nativeRelease: "latest" },
	{ appVersion: "feature-branch", imageTag: "latest", nativeRelease: "latest" },
])(
	"$appVersion selects the published Docker tag and native release",
	async ({ appVersion, imageTag, nativeRelease }) => {
		version.value = appVersion;

		const { createDockerCompose } = await import("../connection-docker");
		const { createConnectionCommand } = await import("../connection-command");
		const yaml = createDockerCompose("https://controller.example", "code", "Agent");
		const command = createConnectionCommand("https://controller.example", "code");

		expect(Bun.YAML.parse(yaml)).toMatchObject({
			services: { agent: { image: `ghcr.io/nicotsx/zerobyte-agent:${imageTag}` } },
		});
		expect(command).toContain(`ZEROBYTE_AGENT_VERSION='${nativeRelease}'`);
	},
);
