import type { RepositoryConfig } from "@zerobyte/core/restic";
import { cryptoUtils, transformOptionalSecret, type SecretTransformer } from "~/server/utils/crypto";

export const mapRepositoryConfigSecrets = async (
	config: RepositoryConfig,
	transformSecret: SecretTransformer,
): Promise<RepositoryConfig> => {
	const customPassword = await transformOptionalSecret(config.customPassword, transformSecret);
	const cacert = await transformOptionalSecret(config.cacert, transformSecret);

	switch (config.backend) {
		case "s3":
		case "r2":
			return {
				...config,
				customPassword,
				cacert,
				accessKeyId: await transformSecret(config.accessKeyId),
				secretAccessKey: await transformSecret(config.secretAccessKey),
			};
		case "b2":
			return {
				...config,
				customPassword,
				cacert,
				accountId: await transformSecret(config.accountId),
				accountKey: await transformSecret(config.accountKey),
			};
		case "gcs":
			return {
				...config,
				customPassword,
				cacert,
				credentialsJson: await transformSecret(config.credentialsJson),
			};
		case "azure":
			return {
				...config,
				customPassword,
				cacert,
				accountKey: await transformSecret(config.accountKey),
			};
		case "rest":
			return {
				...config,
				customPassword,
				cacert,
				username: await transformOptionalSecret(config.username, transformSecret),
				password: await transformOptionalSecret(config.password, transformSecret),
			};
		case "sftp":
			return {
				...config,
				customPassword,
				cacert,
				privateKey: await transformSecret(config.privateKey),
			};
		case "local":
		case "rclone":
			return {
				...config,
				customPassword,
				cacert,
			};
	}
};

export const encryptRepositoryConfig = async (config: RepositoryConfig): Promise<RepositoryConfig> => {
	return await mapRepositoryConfigSecrets(config, cryptoUtils.sealSecret);
};

export const decryptRepositoryConfig = async (config: RepositoryConfig): Promise<RepositoryConfig> => {
	return await mapRepositoryConfigSecrets(config, cryptoUtils.resolveSecret);
};
