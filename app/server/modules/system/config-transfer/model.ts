import type { CompressionMode, RepositoryConfig } from "@zerobyte/core/restic";
import type { BackupWebhooks } from "@zerobyte/core/backup-hooks";
import type { BackendConfig } from "@zerobyte/contracts/volumes";
import type { NotificationConfig } from "~/schemas/notifications";
import type { RetentionPolicy } from "~/schemas/retention";

export type ConfigTransferModel = {
	resticPassword: string;
	repositories: Array<{
		ref: string;
		name: string;
		config: RepositoryConfig;
		compressionMode: CompressionMode;
		autoCheckEnabled: boolean;
	}>;
	machines: Array<{ ref: string; name: string }>;
	volumes: Array<
		| {
				ref: string;
				name: string;
				machineRef: string | null;
				autoRemount: boolean;
				sourceKind: "managed";
				config: BackendConfig;
		  }
		| {
				ref: string;
				name: string;
				machineRef: string | null;
				autoRemount: boolean;
				sourceKind: "agent-filesystem";
				trustedRootId: string;
				relativePath: string;
		  }
	>;
	backupSchedules: Array<{
		ref: string;
		shortId: string;
		name: string;
		volumeRef: string;
		repositoryRef: string;
		enabled: boolean;
		cronExpression: string;
		retentionPolicy: RetentionPolicy | null;
		excludePatterns: string[];
		excludeIfPresent: string[];
		includePaths: string[];
		includePatterns: string[];
		oneFileSystem: boolean;
		customResticParams: string[];
		compressionMode: CompressionMode | null;
		backupWebhooks: BackupWebhooks | null;
		maxRetries: number;
		retryDelay: number;
		sortOrder: number;
	}>;
	notificationDestinations: Array<{
		ref: string;
		name: string;
		enabled: boolean;
		config: NotificationConfig;
	}>;
	backupScheduleMirrors: Array<{
		scheduleRef: string;
		repositoryRef: string;
		enabled: boolean;
	}>;
	backupScheduleNotifications: Array<{
		scheduleRef: string;
		destinationRef: string;
		notifyOnStart: boolean;
		notifyOnSuccess: boolean;
		notifyOnWarning: boolean;
		notifyOnFailure: boolean;
	}>;
};
