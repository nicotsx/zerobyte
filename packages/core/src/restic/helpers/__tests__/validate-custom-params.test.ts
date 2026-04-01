import { describe, expect, test } from "vitest";
import { validateCustomResticParams } from "../validate-custom-params";

describe("validateCustomResticParams", () => {
	test("accepts supported flags and values", () => {
		const result = validateCustomResticParams([
			"--no-scan",
			"--read-concurrency 8",
			"--exclude-larger-than 500M",
			"--pack-size=64",
		]);

		expect(result).toBeNull();
	});

	test("rejects positional arguments", () => {
		const result = validateCustomResticParams(["/etc"]);

		expect(result).toContain('Unexpected positional argument "/etc"');
	});

	test("rejects extra positional arguments after a flag value", () => {
		const result = validateCustomResticParams(["--read-concurrency 8 /etc"]);

		expect(result).toContain('Unexpected positional argument "/etc"');
	});

	test("rejects unsupported path-bearing flags", () => {
		const result = validateCustomResticParams(["--cache-dir /tmp/restic-cache"]);

		expect(result).toContain('Unknown or unsupported flag "--cache-dir"');
	});

	test("rejects dry-run flags", () => {
		expect(validateCustomResticParams(["--dry-run"])).toContain('Unknown or unsupported flag "--dry-run"');
		expect(validateCustomResticParams(["-n"])).toContain('Unknown or unsupported flag "-n"');
	});

	test("rejects missing values for flags that require one", () => {
		const result = validateCustomResticParams(["--read-concurrency"]);

		expect(result).toBe('Flag "--read-concurrency" requires a value');
	});
});
