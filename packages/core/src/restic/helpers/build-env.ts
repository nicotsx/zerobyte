import crypto from "node:crypto";
import path from "node:path";
import type { ResticDeps, ResticEnv } from "../types";
import type { RepositoryConfig } from "../schemas";
import { logger } from "../../node";
import { FILE_MODES, writeFileWithMode } from "../../utils/fs.js";

export const buildEnv = async (
	config: RepositoryConfig,
	organizationId: string,
	deps: ResticDeps,
): Promise<ResticEnv> => {
	const env: ResticEnv = {
		RESTIC_CACHE_DIR: deps.resticCacheDir,
		PATH: process.env.PATH || "/usr/local/bin:/usr/bin:/bin",
	};

	if (config.isExistingRepository && config.customPassword) {
		const decryptedPassword = await deps.resolveSecret(config.customPassword);
		const passwordFilePath = path.join("/tmp", `zerobyte-pass-${crypto.randomBytes(8).toString("hex")}.txt`);

		await writeFileWithMode(passwordFilePath, decryptedPassword, FILE_MODES.ownerReadWrite);
		env.RESTIC_PASSWORD_FILE = passwordFilePath;
	} else {
		const encryptedPassword = await deps.getOrganizationResticPassword(organizationId);
		const decryptedPassword = await deps.resolveSecret(encryptedPassword);
		const passwordFilePath = path.join("/tmp", `zerobyte-pass-${crypto.randomBytes(8).toString("hex")}.txt`);
		await writeFileWithMode(passwordFilePath, decryptedPassword, FILE_MODES.ownerReadWrite);
		env.RESTIC_PASSWORD_FILE = passwordFilePath;
	}

	switch (config.backend) {
		case "s3":
			env.AWS_ACCESS_KEY_ID = await deps.resolveSecret(config.accessKeyId);
			env.AWS_SECRET_ACCESS_KEY = await deps.resolveSecret(config.secretAccessKey);

			if (config.endpoint.includes("myhuaweicloud")) {
				env.AWS_S3_BUCKET_LOOKUP = "dns";
			}
			break;
		case "r2":
			env.AWS_ACCESS_KEY_ID = await deps.resolveSecret(config.accessKeyId);
			env.AWS_SECRET_ACCESS_KEY = await deps.resolveSecret(config.secretAccessKey);
			env.AWS_REGION = "auto";
			env.AWS_S3_FORCE_PATH_STYLE = "true";
			break;
		case "gcs": {
			const decryptedCredentials = await deps.resolveSecret(config.credentialsJson);
			const credentialsPath = path.join("/tmp", `zerobyte-gcs-${crypto.randomBytes(8).toString("hex")}.json`);
			await writeFileWithMode(credentialsPath, decryptedCredentials, FILE_MODES.ownerReadWrite);
			env.GOOGLE_PROJECT_ID = config.projectId;
			env.GOOGLE_APPLICATION_CREDENTIALS = credentialsPath;
			break;
		}
		case "azure": {
			env.AZURE_ACCOUNT_NAME = config.accountName;
			env.AZURE_ACCOUNT_KEY = await deps.resolveSecret(config.accountKey);
			if (config.endpointSuffix) {
				env.AZURE_ENDPOINT_SUFFIX = config.endpointSuffix;
			}
			break;
		}
		case "rest": {
			if (config.username) {
				env.RESTIC_REST_USERNAME = await deps.resolveSecret(config.username);
			}
			if (config.password) {
				env.RESTIC_REST_PASSWORD = await deps.resolveSecret(config.password);
			}
			break;
		}
		case "sftp": {
			const decryptedKey = await deps.resolveSecret(config.privateKey);
			const keyPath = path.join("/tmp", `zerobyte-ssh-${crypto.randomBytes(8).toString("hex")}`);

			let normalizedKey = decryptedKey.replace(/\r\n/g, "\n");
			if (!normalizedKey.endsWith("\n")) {
				normalizedKey += "\n";
			}

			if (normalizedKey.includes("ENCRYPTED")) {
				logger.error("SFTP: Private key appears to be passphrase-protected. Please use an unencrypted key.");
				throw new Error("Passphrase-protected SSH keys are not supported. Please provide an unencrypted private key.");
			}

			await writeFileWithMode(keyPath, normalizedKey, FILE_MODES.ownerReadWrite);

			env._SFTP_KEY_PATH = keyPath;

			const sshArgs = [
				"-o",
				"LogLevel=ERROR",
				"-o",
				"BatchMode=yes",
				"-o",
				"NumberOfPasswordPrompts=0",
				"-o",
				"PreferredAuthentications=publickey",
				"-o",
				"PasswordAuthentication=no",
				"-o",
				"KbdInteractiveAuthentication=no",
				"-o",
				"IdentitiesOnly=yes",
				"-o",
				"ConnectTimeout=10",
				"-o",
				"ConnectionAttempts=1",
				"-o",
				"ServerAliveInterval=60",
				"-o",
				"ServerAliveCountMax=240",
				"-i",
				keyPath,
			];

			if (config.skipHostKeyCheck || !config.knownHosts) {
				sshArgs.push("-o", "StrictHostKeyChecking=no", "-o", "UserKnownHostsFile=/dev/null");
			} else if (config.knownHosts) {
				const knownHostsPath = path.join("/tmp", `zerobyte-known-hosts-${crypto.randomBytes(8).toString("hex")}`);
				await writeFileWithMode(knownHostsPath, config.knownHosts, FILE_MODES.ownerReadWrite);
				env._SFTP_KNOWN_HOSTS_PATH = knownHostsPath;
				sshArgs.push("-o", "StrictHostKeyChecking=yes", "-o", `UserKnownHostsFile=${knownHostsPath}`);
			}

			if (config.port && config.port !== 22) {
				sshArgs.push("-p", String(config.port));
			}

			env._SFTP_SSH_ARGS = sshArgs.join(" ");
			logger.info(`SFTP: SSH args: ${env._SFTP_SSH_ARGS}`);
			break;
		}
	}

	if (config.cacert) {
		const decryptedCert = await deps.resolveSecret(config.cacert);
		const certPath = path.join("/tmp", `zerobyte-cacert-${crypto.randomBytes(8).toString("hex")}.pem`);
		await writeFileWithMode(certPath, decryptedCert, FILE_MODES.ownerReadWrite);
		env.RESTIC_CACERT = certPath;
	}

	if (config.insecureTls) {
		env._INSECURE_TLS = "true";

		if (config.backend === "rclone") {
			env.RCLONE_NO_CHECK_CERTIFICATE = "true";
		}
	}

	return env;
};
