import { describe, expect, test } from "vitest";
import { rcloneConfigSchema } from "@zerobyte/contracts/volumes";

describe("rclone volume configuration", () => {
	test("requires a configured remote name", () => {
		expect(
			rcloneConfigSchema.safeParse({
				backend: "rclone",
				remote: ":sftp,ssh=/bin/sh",
				path: "data",
			}).success,
		).toBe(false);
	});
});
