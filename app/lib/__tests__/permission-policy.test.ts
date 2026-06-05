import { describe, expect, test } from "vitest";
import { evaluatePermission, hasRuntimeFeature } from "../permission-policy";

describe("permissions", () => {
	test("allows organization settings only for org admins in runtimes that support organization administration", () => {
		expect(
			evaluatePermission("organizationSettings.view", {
				runtime: "server",
				orgRole: "admin",
			}).allowed,
		).toBe(true);

		expect(
			evaluatePermission("organizationSettings.view", {
				runtime: "desktop",
				orgRole: "admin",
			}),
		).toEqual({ allowed: false, reason: "runtime" });

		expect(
			evaluatePermission("organizationSettings.view", {
				runtime: "server",
				orgRole: "member",
			}),
		).toEqual({ allowed: false, reason: "orgRole" });
	});

	test("keeps SSO provider creation owner-only and browser-session-only", () => {
		expect(
			evaluatePermission("ssoProvider.create", {
				runtime: "server",
				orgRole: "owner",
				authSource: "browser-session",
			}).allowed,
		).toBe(true);

		expect(
			evaluatePermission("ssoProvider.create", {
				runtime: "server",
				orgRole: "admin",
				authSource: "browser-session",
			}),
		).toEqual({ allowed: false, reason: "orgRole" });

		expect(
			evaluatePermission("ssoProvider.create", {
				runtime: "server",
				orgRole: "owner",
				authSource: "desktop-session",
			}),
		).toEqual({ allowed: false, reason: "authSource" });

		expect(
			evaluatePermission("ssoProvider.create", {
				runtime: "server",
				orgRole: "owner",
				authSource: "api-key",
			}),
		).toEqual({ allowed: false, reason: "authSource" });
	});

	test("allows recovery-key download for browser and desktop sessions but not API keys", () => {
		expect(
			evaluatePermission("recoveryKey.download", {
				runtime: "desktop",
				orgRole: "owner",
				authSource: "desktop-session",
			}).allowed,
		).toBe(true);

		expect(
			evaluatePermission("recoveryKey.download", {
				runtime: "server",
				orgRole: "owner",
				authSource: "browser-session",
			}).allowed,
		).toBe(true);

		expect(
			evaluatePermission("recoveryKey.download", {
				runtime: "desktop",
				orgRole: "owner",
				authSource: "api-key",
			}),
		).toEqual({ allowed: false, reason: "authSource" });
	});

	test("requires desktop-sensitive instance administration to pass runtime, role, and auth source", () => {
		expect(
			evaluatePermission("instanceAdministration.view", {
				runtime: "server",
				instanceRole: "admin",
				authSource: "browser-session",
			}).allowed,
		).toBe(true);

		expect(
			evaluatePermission("instanceAdministration.view", {
				runtime: "desktop",
				instanceRole: "admin",
				authSource: "browser-session",
			}),
		).toEqual({ allowed: false, reason: "runtime" });

		expect(
			evaluatePermission("instanceAdministration.view", {
				runtime: "server",
				instanceRole: "user",
				authSource: "browser-session",
			}),
		).toEqual({ allowed: false, reason: "instanceRole" });

		expect(
			evaluatePermission("passwordLogin.manage", {
				runtime: "server",
				instanceRole: "admin",
				authSource: "browser-session",
			}).allowed,
		).toBe(true);
	});

	test("models runtime features independently from user roles", () => {
		expect(hasRuntimeFeature("server", "remoteVolumeBackends")).toBe(true);
		expect(hasRuntimeFeature("desktop", "remoteVolumeBackends")).toBe(false);
		expect(hasRuntimeFeature("server", "apiKeys")).toBe(true);
		expect(hasRuntimeFeature("desktop", "apiKeys")).toBe(false);
		expect(hasRuntimeFeature("server", "passwordAuthentication")).toBe(true);
		expect(hasRuntimeFeature("desktop", "passwordAuthentication")).toBe(false);
	});
});
