import { describe, expect, test } from "vitest";
import { sanitizeSensitiveData } from "../sanitize";

const withNodeEnv = (nodeEnv: string, fn: () => void) => {
	const originalNodeEnv = process.env.NODE_ENV;
	process.env.NODE_ENV = nodeEnv;

	try {
		fn();
	} finally {
		process.env.NODE_ENV = originalNodeEnv;
	}
};

describe("sanitizeSensitiveData", () => {
	test("redacts escaped comma password values", () => {
		withNodeEnv("production", () => {
			const sanitized = sanitizeSensitiveData(
				"mount -t cifs -o username=user,password=abc\\,LEAKED_SUFFIX //server/share /mnt",
			);

			expect(sanitized).toBe("mount -t cifs -o username=user,password=*** //server/share /mnt");
			expect(sanitized).not.toContain("LEAKED_SUFFIX");
		});
	});

	test.each([
		{
			name: "password key",
			input: "mount -o username=user,password=plainsecret //server/share /mnt",
			expected: "mount -o username=user,password=*** //server/share /mnt",
			secret: "plainsecret",
		},
		{
			name: "pass key",
			input: "backend returned pass=hunter2 while mounting",
			expected: "backend returned pass=*** while mounting",
			secret: "hunter2",
		},
		{
			name: "uppercase key",
			input: "mount -o PASSWORD=CaseSecret //server/share /mnt",
			expected: "mount -o PASSWORD=*** //server/share /mnt",
			secret: "CaseSecret",
		},
		{
			name: "URL basic auth",
			input: "request failed for https://alice:supersecret@example.com/hook",
			expected: "request failed for https://alice:***@example.com/hook",
			secret: "supersecret",
		},
	])("redacts $name", ({ input, expected, secret }) => {
		withNodeEnv("production", () => {
			const sanitized = sanitizeSensitiveData(input);

			expect(sanitized).toBe(expected);
			expect(sanitized).not.toContain(secret);
		});
	});

	test.each([
		"fetch https://example.test/data failed: ENOENT",
		"Error: request https://example.test/data\n    at download (/app/download.ts:12:3)",
	])("preserves URL-bearing diagnostics: %s", (input) => {
		withNodeEnv("production", () => expect(sanitizeSensitiveData(input)).toBe(input));
	});

	test("does not redact in development", () => {
		withNodeEnv("development", () => {
			const input = "mount -o username=user,password=devsecret //server/share /mnt";

			expect(sanitizeSensitiveData(input)).toBe(input);
		});
	});
});
