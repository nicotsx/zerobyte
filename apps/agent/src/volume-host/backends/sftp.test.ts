import type { BackendConfig } from "@zerobyte/contracts/volumes";
import { expect, test } from "vitest";
import { makeSftpBackend } from "./sftp";

const baseSftpConfig: BackendConfig = {
	backend: "sftp",
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

test("rejects unsafe symlink targets when host key checking is skipped", async () => {
	const backend = makeSftpBackend(
		{
			...baseSftpConfig,
			skipHostKeyCheck: true,
			allowUnsafeSymlinkTargets: true,
		},
		"/tmp/zerobyte-sftp-test",
	);

	await expect(backend.mount()).resolves.toEqual({
		status: "error",
		error: "Unsafe symlink targets require host key verification with known hosts",
	});
});

test("rejects unsafe symlink targets without known hosts", async () => {
	const backend = makeSftpBackend(
		{
			...baseSftpConfig,
			knownHosts: undefined,
			allowUnsafeSymlinkTargets: true,
		},
		"/tmp/zerobyte-sftp-test",
	);

	await expect(backend.mount()).resolves.toEqual({
		status: "error",
		error: "Unsafe symlink targets require host key verification with known hosts",
	});
});
