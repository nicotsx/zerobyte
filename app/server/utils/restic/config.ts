import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { RepositoryConfig } from "~/schemas/restic";
import { REPOSITORY_BASE, RESTIC_CACHE_DIR, RESTIC_PASS_FILE } from "../../core/constants";
import { cryptoUtils } from "../crypto";
import { logger } from "../logger";

export const buildRepoUrl = (config: RepositoryConfig): string => {
	if (config.backend === "local") {
		if (config.isExistingRepository) {
			if (!config.path) throw new Error("Path is required for existing local repositories");
			return config.path;
		}
		return config.path ? `${config.path}/${config.name}` : `${REPOSITORY_BASE}/${config.name}`;
	}

	if (config.backend === "s3") return `s3:${config.endpoint}/${config.bucket}`;

	if (config.backend === "r2") {
		const endpoint = config.endpoint.replace(/^https?:\/\//, "");
		return `s3:${endpoint}/${config.bucket}`;
	}

	if (config.backend === "gcs") return `gs:${config.bucket}:/`;
	if (config.backend === "azure") return `azure:${config.container}:/`;
	if (config.backend === "rclone") return `rclone:${config.remote}:${config.path}`;

	if (config.backend === "rest") {
		const path = config.path ? `/${config.path}` : "";
		return `rest:${config.url}${path}`;
	}

	if (config.backend === "sftp") return `sftp:${config.user}@${config.host}:${config.path}`;

	throw new Error(`Unsupported repository backend: ${JSON.stringify(config)}`);
};

export const buildEnv = async (config: RepositoryConfig) => {
	const env: Record<string, string> = {
		RESTIC_CACHE_DIR,
		PATH: process.env.PATH || "/usr/local/bin:/usr/bin:/bin",
	};

	if (config.isExistingRepository && config.customPassword) {
		const decryptedPassword = await cryptoUtils.resolveSecret(config.customPassword);
		const passwordFilePath = path.join("/tmp", `zerobyte-pass-${crypto.randomBytes(8).toString("hex")}.txt`);

		await fs.writeFile(passwordFilePath, decryptedPassword, { mode: 0o600 });
		env.RESTIC_PASSWORD_FILE = passwordFilePath;
	} else {
		env.RESTIC_PASSWORD_FILE = RESTIC_PASS_FILE;
	}

	switch (config.backend) {
		case "s3":
			env.AWS_ACCESS_KEY_ID = await cryptoUtils.resolveSecret(config.accessKeyId);
			env.AWS_SECRET_ACCESS_KEY = await cryptoUtils.resolveSecret(config.secretAccessKey);
			break;
		case "r2":
			env.AWS_ACCESS_KEY_ID = await cryptoUtils.resolveSecret(config.accessKeyId);
			env.AWS_SECRET_ACCESS_KEY = await cryptoUtils.resolveSecret(config.secretAccessKey);
			env.AWS_REGION = "auto";
			env.AWS_S3_FORCE_PATH_STYLE = "true";
			break;
		case "gcs": {
			const decryptedCredentials = await cryptoUtils.resolveSecret(config.credentialsJson);
			const credentialsPath = path.join("/tmp", `zerobyte-gcs-${crypto.randomBytes(8).toString("hex")}.json`);
			await fs.writeFile(credentialsPath, decryptedCredentials, {
				mode: 0o600,
			});
			env.GOOGLE_PROJECT_ID = config.projectId;
			env.GOOGLE_APPLICATION_CREDENTIALS = credentialsPath;
			break;
		}
		case "azure": {
			env.AZURE_ACCOUNT_NAME = config.accountName;
			env.AZURE_ACCOUNT_KEY = await cryptoUtils.resolveSecret(config.accountKey);
			if (config.endpointSuffix) {
				env.AZURE_ENDPOINT_SUFFIX = config.endpointSuffix;
			}
			break;
		}
		case "rest": {
			if (config.username) {
				env.RESTIC_REST_USERNAME = await cryptoUtils.resolveSecret(config.username);
			}
			if (config.password) {
				env.RESTIC_REST_PASSWORD = await cryptoUtils.resolveSecret(config.password);
			}
			break;
		}
		case "sftp": {
			const decryptedKey = await cryptoUtils.resolveSecret(config.privateKey);
			const keyPath = path.join("/tmp", `zerobyte-ssh-${crypto.randomBytes(8).toString("hex")}`);

			let normalizedKey = decryptedKey.replace(/\r\n/g, "\n");
			if (!normalizedKey.endsWith("\n")) {
				normalizedKey += "\n";
				logger.error("SFTP: Private key appears to be passphrase-protected. Please use an unencrypted key.");
				throw new Error("Passphrase-protected SSH keys are not supported. Please provide an unencrypted private key.");
			}

			await fs.writeFile(keyPath, normalizedKey, { mode: 0o600 });

			env._SFTP_KEY_PATH = keyPath;

			const sshArgs = [
				"-o",
				"LogLevel=VERBOSE",
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
				await fs.writeFile(knownHostsPath, config.knownHosts, { mode: 0o600 });
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
		const decryptedCert = await cryptoUtils.resolveSecret(config.cacert);
		const certPath = path.join("/tmp", `zerobyte-cacert-${crypto.randomBytes(8).toString("hex")}.pem`);
		await fs.writeFile(certPath, decryptedCert, { mode: 0o600 });
		env.RESTIC_CACERT = certPath;
	}

	if (config.insecureTls) {
		env._INSECURE_TLS = "true";
	}

	return env;
};
