import fs from "node:fs/promises";
import type { BackendConfig } from "@zerobyte/contracts/volumes";
import { safeExec } from "@zerobyte/core/node";
import type { RepositoryConfig } from "@zerobyte/core/restic";

export const SFTP_HOST = "sftp";
export const SFTP_LEGACY_RSA_HOST = "sftp-legacy-rsa";
export const SFTP_PORT = 22;
export const SFTP_USERNAME = "zerobyte-sftp";
export const SFTP_PASSWORD = "zerobyte-sftp-password";
export const SFTP_FIXTURE_ROOT = "/srv/zerobyte-integration/fixtures";
export const SFTP_REPOSITORY_ROOT = "/srv/zerobyte-integration/repos";

export const readSftpPrivateKey = async () => {
	const privateKeyPath = process.env.SFTP_PRIVATE_KEY_PATH;
	if (!privateKeyPath) {
		throw new Error("SFTP_PRIVATE_KEY_PATH is required for SFTP integration tests");
	}

	return fs.readFile(privateKeyPath, "utf8");
};

export const scanSftpKnownHosts = async ({ host = SFTP_HOST, keyType }: { host?: string; keyType?: string } = {}) => {
	const args = ["-T", "5"];
	if (keyType) args.push("-t", keyType);
	args.push(host);

	const result = await safeExec({
		command: "ssh-keyscan",
		args,
		timeout: 10_000,
	});

	if (result.exitCode !== 0 || result.stdout.trim().length === 0) {
		throw new Error(`Failed to scan SFTP known hosts: ${result.stderr || result.stdout}`);
	}

	return result.stdout;
};

export const buildSftpPrivateKeyVolumeConfig = ({
	privateKey,
	knownHosts,
}: {
	privateKey: string;
	knownHosts: string;
}): BackendConfig => ({
	backend: "sftp",
	host: SFTP_HOST,
	port: SFTP_PORT,
	username: SFTP_USERNAME,
	privateKey,
	path: SFTP_FIXTURE_ROOT,
	readOnly: true,
	skipHostKeyCheck: false,
	knownHosts,
	allowLegacySshRsa: false,
	allowUnsafeSymlinkTargets: false,
});

export const buildSftpPasswordVolumeConfig = ({ knownHosts }: { knownHosts: string }): BackendConfig => ({
	backend: "sftp",
	host: SFTP_HOST,
	port: SFTP_PORT,
	username: SFTP_USERNAME,
	password: SFTP_PASSWORD,
	path: SFTP_FIXTURE_ROOT,
	readOnly: true,
	skipHostKeyCheck: false,
	knownHosts,
	allowLegacySshRsa: false,
	allowUnsafeSymlinkTargets: false,
});

export const buildLegacyRsaSftpPasswordVolumeConfig = ({ knownHosts }: { knownHosts: string }): BackendConfig => ({
	backend: "sftp",
	host: SFTP_LEGACY_RSA_HOST,
	port: SFTP_PORT,
	username: SFTP_USERNAME,
	password: SFTP_PASSWORD,
	path: SFTP_FIXTURE_ROOT,
	readOnly: true,
	skipHostKeyCheck: false,
	knownHosts,
	allowLegacySshRsa: true,
	allowUnsafeSymlinkTargets: false,
});

export const buildSftpRepositoryConfig = ({
	privateKey,
	knownHosts,
	path,
}: {
	privateKey: string;
	knownHosts: string;
	path: string;
}): RepositoryConfig => ({
	backend: "sftp",
	host: SFTP_HOST,
	port: SFTP_PORT,
	user: SFTP_USERNAME,
	path,
	privateKey,
	skipHostKeyCheck: false,
	knownHosts,
	allowLegacySshRsa: false,
});
