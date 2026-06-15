import { describe, expect, test } from "vitest";
import { isPasswordAuthSupported } from "../helpers";

describe("auth helpers", () => {
	test("requires password auth for browser sessions but not desktop sessions", () => {
		expect(isPasswordAuthSupported("browser-session")).toBe(true);
		expect(isPasswordAuthSupported("desktop-session")).toBe(false);
	});
});
