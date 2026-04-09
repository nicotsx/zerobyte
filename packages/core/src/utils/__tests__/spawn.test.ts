import { describe, expect, test } from "vitest";
import { safeExec } from "../spawn";

describe("safeExec", () => {
	test("falls back to the process error message when stderr is empty", async () => {
		const result = await safeExec({
			command: process.execPath,
			args: ["-e", "process.stdout.write('a'.repeat(2 * 1024 * 1024))"],
		});

		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain("stdout maxBuffer length exceeded");
	});
});
