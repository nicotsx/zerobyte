import { describe, expect, test } from "vitest";
import { rcloneRepositoryConfigSchema } from "../../schemas";
import { buildRcloneRemotePath, rcloneRemoteNameSchema } from "../rclone-remote";

describe("rclone remote names", () => {
	test.each([
		"primary",
		"cold archive",
		"münchen",
		"remote_name",
		"remote-name",
		"remote.name",
		"remote+1",
		"ops@home",
	])("accepts configured remote name %s", (remote) => {
		expect(rcloneRemoteNameSchema.parse(remote)).toBe(remote);
	});

	test.each([
		"",
		" remote",
		"remote ",
		"-remote",
		":sftp,ssh=/bin/sh",
		"remote,ssh=/bin/sh",
		"remote=option",
		"remote/path",
		"remote:subpath",
		"remote\nname",
	])("rejects non-name remote reference %s", (remote) => {
		expect(rcloneRemoteNameSchema.safeParse(remote).success).toBe(false);
		expect(() => buildRcloneRemotePath(remote, "backups")).toThrow("configured remote name");
	});

	test("guards repository URL construction inputs", () => {
		expect(
			rcloneRepositoryConfigSchema.safeParse({
				backend: "rclone",
				remote: ":sftp,ssh=/bin/sh",
				path: "backups",
			}).success,
		).toBe(false);
	});
});
