import { beforeEach, describe, expect, test, vi } from "vitest";
import { config } from "~/server/core/config";
import type { AuthMiddlewareContext } from "~/server/lib/auth";
import { systemService } from "~/server/modules/system/system.service";
import { enforcePasswordLoginPolicy } from "../password-login-policy";

const createContext = (path: string) => ({ path }) as AuthMiddlewareContext;

describe("enforcePasswordLoginPolicy", () => {
	beforeEach(() => {
		config.runtime = "server";
		vi.restoreAllMocks();
	});

	test("skips non-password sign-in endpoints", async () => {
		const isPasswordLoginDisabled = vi.spyOn(systemService, "isPasswordLoginDisabled").mockResolvedValue(true);

		await expect(enforcePasswordLoginPolicy(createContext("/sign-in/sso"))).resolves.toBeUndefined();

		expect(isPasswordLoginDisabled).not.toHaveBeenCalled();
	});

	test("allows username password sign-in when password login is enabled", async () => {
		vi.spyOn(systemService, "isPasswordLoginDisabled").mockResolvedValue(false);

		await expect(enforcePasswordLoginPolicy(createContext("/sign-in/username"))).resolves.toBeUndefined();
	});

	test("blocks username and email password sign-in when password login is disabled", async () => {
		vi.spyOn(systemService, "isPasswordLoginDisabled").mockResolvedValue(true);

		await expect(enforcePasswordLoginPolicy(createContext("/sign-in/username"))).rejects.toThrow(
			"Password login is disabled",
		);
		await expect(enforcePasswordLoginPolicy(createContext("/sign-in/email"))).rejects.toThrow(
			"Password login is disabled",
		);
	});

	test("blocks password sign-in when the runtime does not support password authentication", async () => {
		config.runtime = "desktop";
		const isPasswordLoginDisabled = vi.spyOn(systemService, "isPasswordLoginDisabled").mockResolvedValue(false);

		await expect(enforcePasswordLoginPolicy(createContext("/sign-in/username"))).rejects.toThrow(
			"Password login is disabled",
		);
		expect(isPasswordLoginDisabled).not.toHaveBeenCalled();
	});
});
