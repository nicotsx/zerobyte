import type { RepositoryConfig } from "@zerobyte/core/restic";
import { cryptoUtils, type SecretTransformer } from "~/server/utils/crypto";
import {
	prepareSecretConfigUpdate,
	redactConfigSecrets,
	secretAccessor,
	transformConfigSecrets,
	type ConfigSecretPolicy,
	type SecretAccessor,
} from "~/server/utils/config-secret-policy";
import { sealNewSecret, STORED_SECRET } from "~/server/utils/stored-secret";

type RepositoryConfigFor<TBackend extends RepositoryConfig["backend"]> = Extract<
	RepositoryConfig,
	{ backend: TBackend }
>;

const commonSecrets = <TConfig extends { customPassword?: string; cacert?: string }>(): SecretAccessor<TConfig>[] => [
	secretAccessor(
		(config) => config.customPassword,
		(config, customPassword) => ({ ...config, customPassword }),
	),
	secretAccessor(
		(config) => config.cacert,
		(config, cacert) => ({ ...config, cacert }),
	),
];

const repositoryPolicy = <TConfig extends { customPassword?: string; cacert?: string; insecureTls?: boolean }>(
	secrets: SecretAccessor<TConfig>[],
	sameAuthority: ConfigSecretPolicy<TConfig>["sameAuthority"],
): ConfigSecretPolicy<TConfig> => ({
	secrets: [...commonSecrets<TConfig>(), ...secrets],
	sameAuthority: async (stored, submitted) => {
		if (!(await sameAuthority(stored, submitted))) return false;
		if ((stored.insecureTls ?? false) !== (submitted.insecureTls ?? false)) return false;
		if (submitted.cacert === STORED_SECRET) return true;

		const storedCertificate = stored.cacert ?? "";
		const submittedCertificate = submitted.cacert ?? "";
		if (storedCertificate === submittedCertificate) return true;

		return (await cryptoUtils.resolveSecret(storedCertificate)) === submittedCertificate;
	},
});

const objectStorePolicy = <
	TConfig extends {
		customPassword?: string;
		cacert?: string;
		endpoint: string;
		bucket: string;
		accessKeyId: string;
		secretAccessKey: string;
	},
>(): ConfigSecretPolicy<TConfig> =>
	repositoryPolicy(
		[
			secretAccessor(
				(config) => config.accessKeyId,
				(config, accessKeyId) => ({ ...config, accessKeyId }),
			),
			secretAccessor(
				(config) => config.secretAccessKey,
				(config, secretAccessKey) => ({ ...config, secretAccessKey }),
			),
		],
		(stored, submitted) => stored.endpoint === submitted.endpoint && stored.bucket === submitted.bucket,
	);

const s3Policy = objectStorePolicy<RepositoryConfigFor<"s3">>();
const r2Policy = objectStorePolicy<RepositoryConfigFor<"r2">>();

const gcsPolicy = repositoryPolicy<RepositoryConfigFor<"gcs">>(
	[
		secretAccessor(
			(config) => config.credentialsJson,
			(config, credentialsJson) => ({ ...config, credentialsJson }),
		),
	],
	(stored, submitted) => stored.bucket === submitted.bucket && stored.projectId === submitted.projectId,
);

const azurePolicy = repositoryPolicy<RepositoryConfigFor<"azure">>(
	[
		secretAccessor(
			(config) => config.accountKey,
			(config, accountKey) => ({ ...config, accountKey }),
		),
	],
	(stored, submitted) =>
		stored.accountName === submitted.accountName &&
		stored.container === submitted.container &&
		stored.endpointSuffix === submitted.endpointSuffix,
);

const restPolicy = repositoryPolicy<RepositoryConfigFor<"rest">>(
	[
		secretAccessor(
			(config) => config.username,
			(config, username) => ({ ...config, username }),
		),
		secretAccessor(
			(config) => config.password,
			(config, password) => ({ ...config, password }),
		),
	],
	(stored, submitted) => stored.url === submitted.url,
);

const sftpPolicy = repositoryPolicy<RepositoryConfigFor<"sftp">>(
	[
		secretAccessor(
			(config) => config.privateKey,
			(config, privateKey) => ({ ...config, privateKey }),
		),
	],
	(stored, submitted) =>
		stored.host === submitted.host &&
		stored.port === submitted.port &&
		stored.user === submitted.user &&
		stored.path === submitted.path &&
		stored.skipHostKeyCheck === submitted.skipHostKeyCheck &&
		stored.knownHosts === submitted.knownHosts &&
		stored.allowLegacySshRsa === submitted.allowLegacySshRsa,
);

const localPolicy = repositoryPolicy<RepositoryConfigFor<"local">>(
	[],
	(stored, submitted) => stored.path === submitted.path,
);

const rclonePolicy = repositoryPolicy<RepositoryConfigFor<"rclone">>(
	[],
	(stored, submitted) => stored.remote === submitted.remote && stored.path === submitted.path,
);

export const mapRepositoryConfigSecrets = async (
	config: RepositoryConfig,
	transform: SecretTransformer,
): Promise<RepositoryConfig> => {
	switch (config.backend) {
		case "s3":
			return await transformConfigSecrets(config, s3Policy, transform);
		case "r2":
			return await transformConfigSecrets(config, r2Policy, transform);
		case "gcs":
			return await transformConfigSecrets(config, gcsPolicy, transform);
		case "azure":
			return await transformConfigSecrets(config, azurePolicy, transform);
		case "rest":
			return await transformConfigSecrets(config, restPolicy, transform);
		case "sftp":
			return await transformConfigSecrets(config, sftpPolicy, transform);
		case "local":
			return await transformConfigSecrets(config, localPolicy, transform);
		case "rclone":
			return await transformConfigSecrets(config, rclonePolicy, transform);
	}
};

export const encryptRepositoryConfig = async (config: RepositoryConfig): Promise<RepositoryConfig> => {
	return await mapRepositoryConfigSecrets(config, sealNewSecret);
};

export const decryptRepositoryConfig = async (config: RepositoryConfig): Promise<RepositoryConfig> => {
	return await mapRepositoryConfigSecrets(config, cryptoUtils.resolveSecret);
};

export const redactRepositoryConfig = (config: RepositoryConfig): RepositoryConfig => {
	switch (config.backend) {
		case "s3":
			return redactConfigSecrets(config, s3Policy);
		case "r2":
			return redactConfigSecrets(config, r2Policy);
		case "gcs":
			return redactConfigSecrets(config, gcsPolicy);
		case "azure":
			return redactConfigSecrets(config, azurePolicy);
		case "rest":
			return redactConfigSecrets(config, restPolicy);
		case "sftp":
			return redactConfigSecrets(config, sftpPolicy);
		case "local":
			return redactConfigSecrets(config, localPolicy);
		case "rclone":
			return redactConfigSecrets(config, rclonePolicy);
	}
};

export const prepareRepositoryConfigUpdate = async (
	stored: RepositoryConfig,
	submitted: RepositoryConfig,
): Promise<{ config: RepositoryConfig; changed: boolean }> => {
	switch (submitted.backend) {
		case "s3":
			return await prepareSecretConfigUpdate(stored.backend === "s3" ? stored : undefined, submitted, s3Policy);
		case "r2":
			return await prepareSecretConfigUpdate(stored.backend === "r2" ? stored : undefined, submitted, r2Policy);
		case "gcs":
			return await prepareSecretConfigUpdate(stored.backend === "gcs" ? stored : undefined, submitted, gcsPolicy);
		case "azure":
			return await prepareSecretConfigUpdate(
				stored.backend === "azure" ? stored : undefined,
				submitted,
				azurePolicy,
			);
		case "rest":
			return await prepareSecretConfigUpdate(
				stored.backend === "rest" ? stored : undefined,
				submitted,
				restPolicy,
			);
		case "sftp":
			return await prepareSecretConfigUpdate(
				stored.backend === "sftp" ? stored : undefined,
				submitted,
				sftpPolicy,
			);
		case "local":
			return await prepareSecretConfigUpdate(
				stored.backend === "local" ? stored : undefined,
				submitted,
				localPolicy,
			);
		case "rclone":
			return await prepareSecretConfigUpdate(
				stored.backend === "rclone" ? stored : undefined,
				submitted,
				rclonePolicy,
			);
	}
};
