import { beforeEach, describe, expect, test } from "vitest";
import { config } from "~/server/core/config";
import { isPasswordAuthSupported, isSessionAuthSourceAllowed } from "../helpers";

describe("auth helpers", () => {
	beforeEach(() => {
		config.runtime = "server";
	});

	test("allows only the runtime session source and models password auth as a runtime feature", () => {
		expect(isPasswordAuthSupported()).toBe(true);
		expect(isSessionAuthSourceAllowed("browser-session")).toBe(true);
		expect(isSessionAuthSourceAllowed("desktop-session")).toBe(false);

		config.runtime = "desktop";

		expect(isPasswordAuthSupported()).toBe(false);
		expect(isSessionAuthSourceAllowed("browser-session")).toBe(false);
		expect(isSessionAuthSourceAllowed("desktop-session")).toBe(true);
	});
});
