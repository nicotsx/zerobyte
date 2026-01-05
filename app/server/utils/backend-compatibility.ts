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

	// Resolve secrets in both configs for comparison
	const resolvedConfig1 = await cryptoUtils.resolveSecretsDeep(config1);
	const resolvedConfig2 = await cryptoUtils.resolveSecretsDeep(config2);

	switch (group1) {
		case "s3": {
			if (
				(resolvedConfig1.backend === "s3" || resolvedConfig1.backend === "r2") &&
				(resolvedConfig2.backend === "s3" || resolvedConfig2.backend === "r2")
			) {
				return (
					resolvedConfig1.accessKeyId === resolvedConfig2.accessKeyId &&
					resolvedConfig1.secretAccessKey === resolvedConfig2.secretAccessKey
				);
			}
			return false;
		}
		case "gcs": {
			if (resolvedConfig1.backend === "gcs" && resolvedConfig2.backend === "gcs") {
				return (
					resolvedConfig1.credentialsJson === resolvedConfig2.credentialsJson &&
					resolvedConfig1.projectId === resolvedConfig2.projectId
				);
			}
			return false;
		}
		case "azure": {
			if (resolvedConfig1.backend === "azure" && resolvedConfig2.backend === "azure") {
				return (
					resolvedConfig1.accountName === resolvedConfig2.accountName &&
					resolvedConfig1.accountKey === resolvedConfig2.accountKey
				);
			}
			return false;
		}
		case "rest": {
			if (resolvedConfig1.backend === "rest" && resolvedConfig2.backend === "rest") {
				if (
					!resolvedConfig1.username &&
					!resolvedConfig2.username &&
					!resolvedConfig1.password &&
					!resolvedConfig2.password
				) {
					return true;
				}
				return (
					resolvedConfig1.username === resolvedConfig2.username && resolvedConfig1.password === resolvedConfig2.password
				);
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
