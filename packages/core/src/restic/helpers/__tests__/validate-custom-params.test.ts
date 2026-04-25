import fc from "fast-check";
import { describe, expect, test } from "vitest";
import { validateCustomResticParams } from "../validate-custom-params";

const supportedFlagsWithoutValues = [
	"--verbose",
	"-v",
	"--no-scan",
	"--skip-if-unchanged",
	"--exclude-caches",
	"--force",
	"--use-fs-snapshot",
	"--ignore-ctime",
	"--ignore-inode",
	"--with-atime",
	"--no-cache",
	"--cleanup-cache",
	"--no-lock",
] as const;

const positiveIntegerFlags = ["--read-concurrency", "--limit-upload", "--limit-download", "--pack-size"] as const;
const deniedFlags = [
	"--password-command",
	"--password-file",
	"--password",
	"-p",
	"--repository",
	"--repository-file",
	"-r",
	"--option",
	"-o",
	"--key-hint",
	"--tls-client-cert",
	"--cacert",
	"--repo",
] as const;

const validCustomParamArb = fc.oneof(
	fc.constantFrom(...supportedFlagsWithoutValues),
	fc
		.tuple(fc.constantFrom(...positiveIntegerFlags), fc.integer({ min: 1, max: 100_000 }), fc.boolean())
		.map(([flag, value, inline]) => (inline ? `${flag}=${value}` : `${flag} ${value}`)),
	fc
		.tuple(fc.integer({ min: 1, max: 100_000 }), fc.constantFrom("", "K", "M", "G", "T", "KiB", "MiB"), fc.boolean())
		.map(([value, suffix, inline]) =>
			inline ? `--exclude-larger-than=${value}${suffix}` : `--exclude-larger-than ${value}${suffix}`,
		),
);

const flagValueArb = fc
	.array(fc.constantFrom("a", "b", "c", "x", "y", "z", "0", "1", "2", "-", "_", "."), {
		minLength: 1,
		maxLength: 16,
	})
	.map((chars) => chars.join(""))
	.filter((value) => !value.startsWith("-"));

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

	test("accepts generated combinations of supported flags", () => {
		fc.assert(
			fc.property(fc.array(validCustomParamArb, { maxLength: 10 }), (params) => {
				expect(validateCustomResticParams(params)).toBeNull();
			}),
		);
	});

	test("rejects generated denied flags", () => {
		fc.assert(
			fc.property(fc.constantFrom(...deniedFlags), flagValueArb, fc.boolean(), (flag, value, inline) => {
				const param = inline ? `${flag}=${value}` : `${flag} ${value}`;

				expect(validateCustomResticParams([param])).toContain(`Flag "${flag}" is not permitted`);
			}),
		);
	});
});
