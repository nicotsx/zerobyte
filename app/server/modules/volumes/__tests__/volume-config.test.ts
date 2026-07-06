import { volumeConfigSchema } from "@zerobyte/contracts/volumes";
import { describe, expect, test } from "vitest";

const baseSftpConfig = {
	backend: "sftp" as const,
	host: "backup.example.com",
	port: 22,
	username: "backup",
	password: "password",
	path: "/backups",
	readOnly: true,
	skipHostKeyCheck: false,
	knownHosts: "backup.example.com ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAITest",
	allowLegacySshRsa: false,
	allowUnsafeSymlinkTargets: false,
};

describe("volumeConfigSchema", () => {
	test("allows unsafe SFTP symlink targets with verified known hosts", () => {
		const result = volumeConfigSchema.safeParse({
			...baseSftpConfig,
			allowUnsafeSymlinkTargets: true,
		});

		expect(result.success).toBe(true);
	});

	test("rejects unsafe SFTP symlink targets when host key checking is skipped", () => {
		const result = volumeConfigSchema.safeParse({
			...baseSftpConfig,
			skipHostKeyCheck: true,
			allowUnsafeSymlinkTargets: true,
		});

		expect(result.success).toBe(false);
	});

	test("rejects unsafe SFTP symlink targets without known hosts", () => {
		const result = volumeConfigSchema.safeParse({
			...baseSftpConfig,
			knownHosts: undefined,
			allowUnsafeSymlinkTargets: true,
		});

		expect(result.success).toBe(false);
	});

	test("keeps skip host key check valid when unsafe symlink targets are disabled", () => {
		const result = volumeConfigSchema.safeParse({
			...baseSftpConfig,
			skipHostKeyCheck: true,
			knownHosts: undefined,
			allowUnsafeSymlinkTargets: false,
		});

		expect(result.success).toBe(true);
	});
});
