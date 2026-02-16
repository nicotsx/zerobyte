import { describe, expect, test } from "bun:test";
import { isValidUsername, normalizeUsername } from "~/lib/username";

describe("username helpers", () => {
	test("normalizes usernames by trimming and lowercasing", () => {
		expect(normalizeUsername("  Admin-User  ")).toBe("admin-user");
	});

	test("accepts usernames containing a hyphen", () => {
		expect(isValidUsername(normalizeUsername("Admin-User"))).toBe(true);
	});

	test("accepts letters, numbers, dots, and underscores", () => {
		expect(isValidUsername("admin.user_01")).toBe(true);
	});

	test("rejects usernames with unsupported characters", () => {
		expect(isValidUsername("admin user")).toBe(false);
		expect(isValidUsername("admin@user")).toBe(false);
	});
});
