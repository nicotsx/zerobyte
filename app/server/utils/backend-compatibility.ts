import type { RepositoryConfig } from "~/schemas/restic";
import { cryptoUtils } from "./crypto";

type BackendConflictGroup = "s3" | "gcs" | "azure" | "rest" | "sftp" | null;

export const getBackendConflictGroup = (backend: string): BackendConflictGroup => {
	switch (backend) {
		case "s3":
		case "r2":
			return "s3";
		case "gcs":
			return "gcs";
		case "azure":
			return "azure";
		case "rest":
			return "rest";
		case "sftp":
			return "sftp";
		case "local":
		case "rclone":
			return null;
		default:
			return null;
	}
};

export const hasCompatibleCredentials = async (
	config1: RepositoryConfig,
	config2: RepositoryConfig,
): Promise<boolean> => {
	const group1 = getBackendConflictGroup(config1.backend);
	const group2 = getBackendConflictGroup(config2.backend);

	if (!group1 || !group2 || group1 !== group2) {
		return true;
	}

	switch (group1) {
		case "s3": {
			if (
				(config1.backend === "s3" || config1.backend === "r2") &&
				(config2.backend === "s3" || config2.backend === "r2")
			) {
				const accessKey1 = await cryptoUtils.resolveSecret(config1.accessKeyId);
				const secretKey1 = await cryptoUtils.resolveSecret(config1.secretAccessKey);

				const accessKey2 = await cryptoUtils.resolveSecret(config2.accessKeyId);
				const secretKey2 = await cryptoUtils.resolveSecret(config2.secretAccessKey);

				return accessKey1 === accessKey2 && secretKey1 === secretKey2;
			}
			return false;
		}
		case "gcs": {
			if (config1.backend === "gcs" && config2.backend === "gcs") {
				const credentials1 = await cryptoUtils.resolveSecret(config1.credentialsJson);
				const credentials2 = await cryptoUtils.resolveSecret(config2.credentialsJson);

				return credentials1 === credentials2 && config1.projectId === config2.projectId;
			}
			return false;
		}
		case "azure": {
			if (config1.backend === "azure" && config2.backend === "azure") {
				const config1Accountkey = await cryptoUtils.resolveSecret(config1.accountKey);
				const config2Accountkey = await cryptoUtils.resolveSecret(config2.accountKey);

				return config1.accountName === config2.accountName && config1Accountkey === config2Accountkey;
			}
			return false;
		}
		case "rest": {
			if (config1.backend === "rest" && config2.backend === "rest") {
				if (!config1.username && !config2.username && !config1.password && !config2.password) {
					return true;
				}

				const config1Username = await cryptoUtils.resolveSecret(config1.username || "");
				const config1Password = await cryptoUtils.resolveSecret(config1.password || "");
				const config2Username = await cryptoUtils.resolveSecret(config2.username || "");
				const config2Password = await cryptoUtils.resolveSecret(config2.password || "");

				return config1Username === config2Username && config1Password === config2Password;
			}
			return false;
		}
		case "sftp": {
			return false;
		}
		default:
			return false;
	}
};

export interface CompatibilityResult {
	repositoryId: string;
	compatible: boolean;
	reason: string | null;
}

export const checkMirrorCompatibility = async (
	primaryConfig: RepositoryConfig,
	mirrorConfig: RepositoryConfig,
	mirrorRepositoryId: string,
): Promise<CompatibilityResult> => {
	const primaryConflictGroup = getBackendConflictGroup(primaryConfig.backend);
	const mirrorConflictGroup = getBackendConflictGroup(mirrorConfig.backend);

	if (!primaryConflictGroup || !mirrorConflictGroup) {
		return {
			repositoryId: mirrorRepositoryId,
			compatible: true,
			reason: null,
		};
	}

	if (primaryConflictGroup !== mirrorConflictGroup) {
		return {
			repositoryId: mirrorRepositoryId,
			compatible: true,
			reason: null,
		};
	}

	const compatible = await hasCompatibleCredentials(primaryConfig, mirrorConfig);

	if (compatible) {
		return {
			repositoryId: mirrorRepositoryId,
			compatible: true,
			reason: null,
		};
	}

	return {
		repositoryId: mirrorRepositoryId,
		compatible: false,
		reason: `Both use ${primaryConflictGroup.toUpperCase()} backends with different credentials`,
	};
};

export const getIncompatibleMirrorError = (mirrorRepoName: string, primaryBackend: string, mirrorBackend: string) => {
	return (
		`Cannot mirror to ${mirrorRepoName}: both repositories use the same backend type (${primaryBackend}/${mirrorBackend}) with different credentials. ` +
		"Restic cannot use different credentials for the same backend in a copy operation. " +
		"Consider creating a new backup scheduler with the desired destination instead."
	);
};
