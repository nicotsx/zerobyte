import { smbConfigSchema, webdavConfigSchema, sftpConfigSchema, type BackendConfig } from "@zerobyte/contracts/volumes";
import { cryptoUtils, type SecretTransformer } from "~/server/utils/crypto";
import {
	prepareSecretConfigUpdate,
	redactConfigSecrets,
	secretAccessor,
	transformConfigSecrets,
	type ConfigSecretPolicy,
} from "~/server/utils/config-secret-policy";
import { sealNewSecret } from "~/server/utils/stored-secret";

type BackendConfigFor<TBackend extends BackendConfig["backend"]> = Extract<BackendConfig, { backend: TBackend }>;

const smbPolicy: ConfigSecretPolicy<BackendConfigFor<"smb">> = {
	secrets: [
		secretAccessor(
			(config) => config.password,
			(config, password) => ({ ...config, password }),
		),
	],
	sameAuthority: (stored, submitted) =>
		stored.server === submitted.server &&
		stored.port === submitted.port &&
		stored.share === submitted.share &&
		stored.domain === submitted.domain &&
		stored.username === submitted.username,
};

const webdavPolicy: ConfigSecretPolicy<BackendConfigFor<"webdav">> = {
	secrets: [
		secretAccessor(
			(config) => config.password,
			(config, password) => ({ ...config, password }),
		),
	],
	sameAuthority: (stored, submitted) =>
		stored.server === submitted.server &&
		stored.port === submitted.port &&
		stored.ssl === submitted.ssl &&
		stored.path === submitted.path &&
		stored.username === submitted.username,
};

const sftpPolicy: ConfigSecretPolicy<BackendConfigFor<"sftp">> = {
	secrets: [
		secretAccessor(
			(config) => config.password,
			(config, password) => ({ ...config, password }),
		),
		secretAccessor(
			(config) => config.privateKey,
			(config, privateKey) => ({ ...config, privateKey }),
		),
	],
	sameAuthority: (stored, submitted) =>
		stored.host === submitted.host &&
		stored.port === submitted.port &&
		stored.username === submitted.username &&
		stored.path === submitted.path &&
		stored.skipHostKeyCheck === submitted.skipHostKeyCheck &&
		stored.knownHosts === submitted.knownHosts &&
		stored.allowLegacySshRsa === submitted.allowLegacySshRsa,
};

const nfsPolicy: ConfigSecretPolicy<BackendConfigFor<"nfs">> = { secrets: [], sameAuthority: () => true };
const directoryPolicy: ConfigSecretPolicy<BackendConfigFor<"directory">> = { secrets: [], sameAuthority: () => true };
const rclonePolicy: ConfigSecretPolicy<BackendConfigFor<"rclone">> = { secrets: [], sameAuthority: () => true };

export const mapVolumeConfigSecrets = async (
	config: BackendConfig,
	transform: SecretTransformer,
): Promise<BackendConfig> => {
	switch (config.backend) {
		case "smb":
			return await transformConfigSecrets(config, smbPolicy, transform);
		case "webdav":
			return await transformConfigSecrets(config, webdavPolicy, transform);
		case "sftp":
			return await transformConfigSecrets(config, sftpPolicy, transform);
		case "nfs":
			return await transformConfigSecrets(config, nfsPolicy, transform);
		case "directory":
			return await transformConfigSecrets(config, directoryPolicy, transform);
		case "rclone":
			return await transformConfigSecrets(config, rclonePolicy, transform);
	}
};

export const encryptVolumeConfig = async (config: BackendConfig): Promise<BackendConfig> => {
	return await mapVolumeConfigSecrets(config, sealNewSecret);
};

export const decryptVolumeConfig = async (config: BackendConfig): Promise<BackendConfig> => {
	return await mapVolumeConfigSecrets(config, cryptoUtils.resolveSecret);
};

export const redactVolumeConfig = (config: BackendConfig): BackendConfig => {
	switch (config.backend) {
		case "smb":
			return redactConfigSecrets(config, smbPolicy);
		case "webdav":
			return redactConfigSecrets(config, webdavPolicy);
		case "sftp":
			return redactConfigSecrets(config, sftpPolicy);
		case "nfs":
			return redactConfigSecrets(config, nfsPolicy);
		case "directory":
			return redactConfigSecrets(config, directoryPolicy);
		case "rclone":
			return redactConfigSecrets(config, rclonePolicy);
	}
};

export const prepareVolumeConfigUpdate = async (
	stored: BackendConfig,
	submitted: BackendConfig,
): Promise<{ config: BackendConfig; changed: boolean }> => {
	switch (submitted.backend) {
		case "smb":
			return await prepareSecretConfigUpdate(
				stored.backend === "smb" ? smbConfigSchema.parse(stored) : undefined,
				submitted,
				smbPolicy,
			);
		case "webdav":
			return await prepareSecretConfigUpdate(
				stored.backend === "webdav" ? webdavConfigSchema.parse(stored) : undefined,
				submitted,
				webdavPolicy,
			);
		case "sftp":
			return await prepareSecretConfigUpdate(
				stored.backend === "sftp" ? sftpConfigSchema.parse(stored) : undefined,
				submitted,
				sftpPolicy,
			);
		case "nfs":
			return await prepareSecretConfigUpdate(stored.backend === "nfs" ? stored : undefined, submitted, nfsPolicy);
		case "directory":
			return await prepareSecretConfigUpdate(
				stored.backend === "directory" ? stored : undefined,
				submitted,
				directoryPolicy,
			);
		case "rclone":
			return await prepareSecretConfigUpdate(
				stored.backend === "rclone" ? stored : undefined,
				submitted,
				rclonePolicy,
			);
	}
};
