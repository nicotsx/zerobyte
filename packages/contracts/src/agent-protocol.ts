import { z } from "zod";
import { backupWebhooksSchema } from "@zerobyte/core/backup-hooks";
import { safeJsonParse } from "@zerobyte/core/utils";
import {
	repositoryConfigSchema,
	resticBackupOutputSchema,
	resticBackupProgressSchema,
	resticRestoreOutputSchema,
	restoreProgressSchema,
	type CompressionMode,
	type SnapshotRestoreRequest,
} from "@zerobyte/core/restic";
import {
	browseFilesystemResponseSchema,
	listVolumeFilesResponseSchema,
	statfsSchema,
	testVolumeConnectionResponseSchema,
	volumeConfigSchema,
	volumeOperationResultSchema,
	volumeSchema,
} from "./volumes";

const compressionModeSchema = z.enum(["off", "auto", "max"]) satisfies z.ZodType<CompressionMode>;

export const AGENT_PROTOCOL_VERSION = 1;
export const SUPPORTED_AGENT_PROTOCOL_MIN_VERSION = 1;
export const SUPPORTED_AGENT_PROTOCOL_MAX_VERSION = 1;

export type AgentProtocolRejectionReason =
	| "agent_too_old"
	| "agent_too_new"
	| "invalid_agent_ready"
	| "unexpected_startup_message"
	| "invalid_startup_json";

export type AgentProtocolRejection = {
	reason: AgentProtocolRejectionReason;
	protocolVersion?: number;
	supportedProtocolMinVersion: number;
	supportedProtocolMaxVersion: number;
	hostname?: string;
	platform?: string;
	messageType?: string;
};

const backupExecutionOptionsSchema = z.object({
	oneFileSystem: z.boolean(),
	excludePatterns: z.array(z.string()).nullable(),
	excludeIfPresent: z.array(z.string()).nullable(),
	includePaths: z.array(z.string()).nullable(),
	includePatterns: z.array(z.string()).nullable(),
	customResticParams: z.array(z.string()).nullable(),
	compressionMode: compressionModeSchema,
});

const commandRuntimeSchema = z.object({
	password: z.string(),
});

const backupRunSchema = z.object({
	type: z.literal("backup.run"),
	payload: z.object({
		jobId: z.string(),
		scheduleId: z.string(),
		organizationId: z.string(),
		volume: volumeSchema,
		repositoryConfig: repositoryConfigSchema,
		options: backupExecutionOptionsSchema,
		runtime: commandRuntimeSchema,
		webhooks: backupWebhooksSchema,
		webhookAllowedOrigins: z.array(z.string()),
		webhookTimeoutMs: z.number(),
	}),
});

const backupCancelSchema = z.object({
	type: z.literal("backup.cancel"),
	payload: z.object({ jobId: z.string(), scheduleId: z.string() }),
});

const volumeCommandSchema = z.discriminatedUnion("name", [
	z.object({ name: z.literal("volume.mount"), volume: volumeSchema }),
	z.object({ name: z.literal("volume.unmount"), volume: volumeSchema }),
	z.object({ name: z.literal("volume.checkHealth"), volume: volumeSchema }),
	z.object({ name: z.literal("volume.statfs"), volume: volumeSchema }),
	z.object({
		name: z.literal("volume.listFiles"),
		volume: volumeSchema,
		subPath: z.string().optional(),
		offset: z.number(),
		limit: z.number(),
	}),
	z.object({ name: z.literal("volume.testConnection"), backendConfig: volumeConfigSchema }),
	z.object({ name: z.literal("filesystem.browse"), path: z.string() }),
]);

const volumeCommandRequestSchema = z.object({
	type: z.literal("volume.command"),
	payload: z.object({
		commandId: z.string(),
		command: volumeCommandSchema,
	}),
});

const volumeCommandResultSchema = z.discriminatedUnion("name", [
	z.object({ name: z.literal("volume.mount"), result: volumeOperationResultSchema }),
	z.object({ name: z.literal("volume.unmount"), result: volumeOperationResultSchema }),
	z.object({ name: z.literal("volume.checkHealth"), result: volumeOperationResultSchema }),
	z.object({ name: z.literal("volume.statfs"), result: statfsSchema }),
	z.object({ name: z.literal("volume.listFiles"), result: listVolumeFilesResponseSchema }),
	z.object({ name: z.literal("volume.testConnection"), result: testVolumeConnectionResponseSchema }),
	z.object({ name: z.literal("filesystem.browse"), result: browseFilesystemResponseSchema }),
]);

const volumeCommandResponseSchema = z.object({
	type: z.literal("volume.commandResult"),
	payload: z.discriminatedUnion("status", [
		z.object({ commandId: z.string(), status: z.literal("success"), command: volumeCommandResultSchema }),
		z.object({ commandId: z.string(), status: z.literal("error"), error: z.string() }),
	]),
});

const restoreIdentitySchema = z.object({
	restoreId: z.string(),
	organizationId: z.string(),
	repositoryId: z.string(),
	snapshotId: z.string(),
});

const overwriteModeSchema = z.enum(["always", "if-changed", "if-newer", "never"]);

const snapshotRestoreRequestSchema = z.object({
	location: z.discriminatedUnion("kind", [
		z.object({ kind: z.literal("original") }),
		z.object({ kind: z.literal("custom"), targetPath: z.string().min(1) }),
	]),
	include: z.array(z.string()).optional(),
	selectedItemKind: z.enum(["file", "dir"]).optional(),
	exclude: z.array(z.string()).optional(),
	excludeXattr: z.array(z.string()).optional(),
	delete: z.boolean().optional(),
	overwrite: overwriteModeSchema.optional(),
}) satisfies z.ZodType<SnapshotRestoreRequest>;

const restoreRunSchema = z.object({
	type: z.literal("restore.run"),
	payload: restoreIdentitySchema.extend({
		snapshotPaths: z.array(z.string()),
		repositoryConfig: repositoryConfigSchema,
		runtime: commandRuntimeSchema,
		request: snapshotRestoreRequestSchema,
	}),
});

const restoreCancelSchema = z.object({
	type: z.literal("restore.cancel"),
	payload: z.object({ restoreId: z.string() }),
});

const restoreStartedSchema = z.object({
	type: z.literal("restore.started"),
	payload: restoreIdentitySchema,
});

const restoreProgressMessageSchema = z.object({
	type: z.literal("restore.progress"),
	payload: restoreIdentitySchema.extend({
		progress: restoreProgressSchema,
	}),
});

const restoreCompletedSchema = z.object({
	type: z.literal("restore.completed"),
	payload: restoreIdentitySchema.extend({
		result: resticRestoreOutputSchema,
	}),
});

const restoreFailedSchema = z.object({
	type: z.literal("restore.failed"),
	payload: restoreIdentitySchema.extend({
		error: z.string(),
		errorDetails: z.string().optional(),
	}),
});

const restoreCancelledSchema = z.object({
	type: z.literal("restore.cancelled"),
	payload: restoreIdentitySchema.extend({
		message: z.string().optional(),
	}),
});

const heartbeatPingSchema = z.object({
	type: z.literal("heartbeat.ping"),
	payload: z.object({ sentAt: z.number() }),
});

const agentReadySchema = z.object({
	type: z.literal("agent.ready"),
	payload: z.object({
		agentId: z.string(),
		protocolVersion: z.number(),
		hostname: z.string(),
		platform: z.string(),
		capabilities: z.record(z.string(), z.unknown()),
	}),
});

const agentStartupMessageSchema = z.object({
	type: z.string(),
	payload: z.unknown().optional(),
});

const stableAgentReadySchema = z.object({
	type: z.literal("agent.ready"),
	payload: z.object({
		protocolVersion: z.number(),
		hostname: z.string().optional(),
		platform: z.string().optional(),
		capabilities: z.record(z.string(), z.unknown()).optional(),
	}),
});

const backupStartedSchema = z.object({
	type: z.literal("backup.started"),
	payload: z.object({ jobId: z.string(), scheduleId: z.string() }),
});

const backupProgressSchema = z.object({
	type: z.literal("backup.progress"),
	payload: z.object({
		jobId: z.string(),
		scheduleId: z.string(),
		progress: resticBackupProgressSchema,
	}),
});

const backupCompletedSchema = z.object({
	type: z.literal("backup.completed"),
	payload: z.object({
		jobId: z.string(),
		scheduleId: z.string(),
		exitCode: z.number(),
		result: resticBackupOutputSchema.nullable(),
		warningDetails: z.string().optional(),
	}),
});

const backupFailedSchema = z.object({
	type: z.literal("backup.failed"),
	payload: z.object({
		jobId: z.string(),
		scheduleId: z.string(),
		error: z.string(),
		errorDetails: z.string().optional(),
	}),
});

const backupCancelledSchema = z.object({
	type: z.literal("backup.cancelled"),
	payload: z.object({
		jobId: z.string(),
		scheduleId: z.string(),
		message: z.string().optional(),
	}),
});

const heartbeatPongSchema = z.object({
	type: z.literal("heartbeat.pong"),
	payload: z.object({ sentAt: z.number() }),
});

const controllerMessageSchema = z.discriminatedUnion("type", [
	backupRunSchema,
	backupCancelSchema,
	volumeCommandRequestSchema,
	restoreRunSchema,
	restoreCancelSchema,
	heartbeatPingSchema,
]);
const agentMessageSchema = z.discriminatedUnion("type", [
	agentReadySchema,
	backupStartedSchema,
	backupProgressSchema,
	backupCompletedSchema,
	backupFailedSchema,
	backupCancelledSchema,
	volumeCommandResponseSchema,
	restoreStartedSchema,
	restoreProgressMessageSchema,
	restoreCompletedSchema,
	restoreFailedSchema,
	restoreCancelledSchema,
	heartbeatPongSchema,
]);

export type BackupRunPayload = z.infer<typeof backupRunSchema>["payload"];
export type BackupCancelPayload = z.infer<typeof backupCancelSchema>["payload"];
export type BackupStartedPayload = z.infer<typeof backupStartedSchema>["payload"];
export type BackupProgressPayload = z.infer<typeof backupProgressSchema>["payload"];
export type BackupCompletedPayload = z.infer<typeof backupCompletedSchema>["payload"];
export type BackupFailedPayload = z.infer<typeof backupFailedSchema>["payload"];
export type BackupCancelledPayload = z.infer<typeof backupCancelledSchema>["payload"];
export type VolumeCommandPayload = z.infer<typeof volumeCommandRequestSchema>["payload"];
export type VolumeCommand = z.infer<typeof volumeCommandSchema>;
export type VolumeCommandResult = z.infer<typeof volumeCommandResultSchema>;
export type VolumeCommandResponsePayload = z.infer<typeof volumeCommandResponseSchema>["payload"];
export type RestoreRunPayload = z.infer<typeof restoreRunSchema>["payload"];
export type RestoreCancelPayload = z.infer<typeof restoreCancelSchema>["payload"];
export type RestoreStartedPayload = z.infer<typeof restoreStartedSchema>["payload"];
export type RestoreProgressPayload = z.infer<typeof restoreProgressMessageSchema>["payload"];
export type RestoreCompletedPayload = z.infer<typeof restoreCompletedSchema>["payload"];
export type RestoreFailedPayload = z.infer<typeof restoreFailedSchema>["payload"];
export type RestoreCancelledPayload = z.infer<typeof restoreCancelledSchema>["payload"];
export type ControllerMessage = z.infer<typeof controllerMessageSchema>;
export type AgentMessage = z.infer<typeof agentMessageSchema>;

type Brand<TValue, TBrand extends string> = TValue & {
	readonly __brand: TBrand;
};

export type ControllerWireMessage = Brand<string, "ControllerWireMessage">;
export type AgentWireMessage = Brand<string, "AgentWireMessage">;

type PayloadForMessage<TMessage extends { type: string; payload: unknown }, TType extends TMessage["type"]> = Extract<
	TMessage,
	{ type: TType }
>["payload"];

export const parseControllerMessage = (data: string) => {
	const parsed = safeJsonParse(data);
	if (parsed === null) {
		return null;
	}

	return controllerMessageSchema.safeParse(parsed);
};

export const parseAgentMessage = (data: string) => {
	const parsed = safeJsonParse(data);
	if (parsed === null) {
		return null;
	}

	return agentMessageSchema.safeParse(parsed);
};

export const parseAgentStartupMessage = (data: string): AgentProtocolRejection | { success: true; data: unknown } => {
	const parsed = safeJsonParse(data);
	if (parsed === null) {
		return {
			reason: "invalid_startup_json",
			supportedProtocolMinVersion: SUPPORTED_AGENT_PROTOCOL_MIN_VERSION,
			supportedProtocolMaxVersion: SUPPORTED_AGENT_PROTOCOL_MAX_VERSION,
		};
	}

	const startupMessage = agentStartupMessageSchema.safeParse(parsed);
	if (!startupMessage.success) {
		return {
			reason: "unexpected_startup_message",
			supportedProtocolMinVersion: SUPPORTED_AGENT_PROTOCOL_MIN_VERSION,
			supportedProtocolMaxVersion: SUPPORTED_AGENT_PROTOCOL_MAX_VERSION,
		};
	}

	if (startupMessage.data.type !== "agent.ready") {
		return {
			reason: "unexpected_startup_message",
			messageType: startupMessage.data.type,
			supportedProtocolMinVersion: SUPPORTED_AGENT_PROTOCOL_MIN_VERSION,
			supportedProtocolMaxVersion: SUPPORTED_AGENT_PROTOCOL_MAX_VERSION,
		};
	}

	const readyMessage = stableAgentReadySchema.safeParse(parsed);
	if (!readyMessage.success) {
		return {
			reason: "invalid_agent_ready",
			supportedProtocolMinVersion: SUPPORTED_AGENT_PROTOCOL_MIN_VERSION,
			supportedProtocolMaxVersion: SUPPORTED_AGENT_PROTOCOL_MAX_VERSION,
		};
	}

	const { protocolVersion, hostname, platform } = readyMessage.data.payload;
	if (protocolVersion < SUPPORTED_AGENT_PROTOCOL_MIN_VERSION) {
		return {
			reason: "agent_too_old",
			protocolVersion,
			hostname,
			platform,
			supportedProtocolMinVersion: SUPPORTED_AGENT_PROTOCOL_MIN_VERSION,
			supportedProtocolMaxVersion: SUPPORTED_AGENT_PROTOCOL_MAX_VERSION,
		};
	}

	if (protocolVersion > SUPPORTED_AGENT_PROTOCOL_MAX_VERSION) {
		return {
			reason: "agent_too_new",
			protocolVersion,
			hostname,
			platform,
			supportedProtocolMinVersion: SUPPORTED_AGENT_PROTOCOL_MIN_VERSION,
			supportedProtocolMaxVersion: SUPPORTED_AGENT_PROTOCOL_MAX_VERSION,
		};
	}

	return { success: true, data: parsed };
};

export const createControllerMessage = <TType extends ControllerMessage["type"]>(
	type: TType,
	payload: PayloadForMessage<ControllerMessage, TType>,
) => {
	return JSON.stringify(controllerMessageSchema.parse({ type, payload })) as ControllerWireMessage;
};

export const createAgentMessage = <TType extends AgentMessage["type"]>(
	type: TType,
	payload: PayloadForMessage<AgentMessage, TType>,
) => {
	return JSON.stringify(agentMessageSchema.parse({ type, payload })) as AgentWireMessage;
};
