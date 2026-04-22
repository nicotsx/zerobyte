import type { BackendConfig } from "~/schemas/volumes";
import { cryptoUtils, transformOptionalSecret, type SecretTransformer } from "~/server/utils/crypto";

export const mapVolumeConfigSecrets = async (
	config: BackendConfig,
	transformSecret: SecretTransformer,
): Promise<BackendConfig> => {
	switch (config.backend) {
		case "smb":
			return {
				...config,
				password: await transformOptionalSecret(config.password, transformSecret),
			};
		case "webdav":
			return {
				...config,
				password: await transformOptionalSecret(config.password, transformSecret),
			};
		case "sftp":
			return {
				...config,
				password: await transformOptionalSecret(config.password, transformSecret),
				privateKey: await transformOptionalSecret(config.privateKey, transformSecret),
			};
		case "nfs":
		case "directory":
		case "rclone":
			return config;
	}
};

export const encryptVolumeConfig = async (config: BackendConfig): Promise<BackendConfig> => {
	return await mapVolumeConfigSecrets(config, cryptoUtils.sealSecret);
};
