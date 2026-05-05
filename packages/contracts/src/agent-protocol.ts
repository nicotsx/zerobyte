import { z } from "zod";
import { backupWebhooksSchema } from "@zerobyte/core/backup-hooks";
import { safeJsonParse } from "@zerobyte/core/utils";
import {
	repositoryConfigSchema,
	resticBackupOutputSchema,
	resticBackupProgressSchema,
	type CompressionMode,
} from "@zerobyte/core/restic";

const compressionModeSchema = z.enum(["off", "auto", "max"]) satisfies z.ZodType<CompressionMode>;

const backupExecutionOptionsSchema = z.object({
	tags: z.array(z.string()).optional(),
	oneFileSystem: z.boolean().optional(),
	exclude: z.array(z.string()).optional(),
	excludeIfPresent: z.array(z.string()).optional(),
	includePaths: z.array(z.string()).optional(),
	includePatterns: z.array(z.string()).optional(),
	customResticParams: z.array(z.string()).optional(),
	compressionMode: compressionModeSchema.optional(),
});

const backupRuntimeSchema = z.object({
	password: z.string(),
	cacheDir: z.string(),
	passFile: z.string(),
	defaultExcludes: z.array(z.string()),
	hostname: z.string().optional(),
	rcloneConfigFile: z.string(),
});

const backupRunSchema = z.object({
	type: z.literal("backup.run"),
	payload: z.object({
		jobId: z.string(),
		scheduleId: z.string(),
		organizationId: z.string(),
		sourcePath: z.string(),
		repositoryConfig: repositoryConfigSchema,
		options: backupExecutionOptionsSchema,
		runtime: backupRuntimeSchema,
		webhooks: backupWebhooksSchema,
		webhookAllowedOrigins: z.array(z.string()),
		webhookTimeoutMs: z.number(),
	}),
});

const backupCancelSchema = z.object({
	type: z.literal("backup.cancel"),
	payload: z.object({ jobId: z.string(), scheduleId: z.string() }),
});

const backendStatusSchema = z.enum(["mounted", "unmounted", "error"]);

const volumeSchema = z.object({
	id: z.number(),
	shortId: z.string(),
	name: z.string(),
	path: z.string().nullable().optional(),
	config: z.record(z.string(), z.unknown()).and(z.object({ backend: z.string() })),
	createdAt: z.number(),
	updatedAt: z.number(),
	lastHealthCheck: z.number(),
	type: z.string(),
	status: backendStatusSchema,
	lastError: z.string().nullable(),
	provisioningId: z.string().nullable().optional(),
	autoRemount: z.boolean(),
	agentId: z.string(),
	organizationId: z.string(),
});

const volumeOperationResultSchema = z.object({
	status: backendStatusSchema,
	error: z.string().optional(),
});

const statfsSchema = z.object({
	total: z.number().optional(),
	used: z.number().optional(),
	free: z.number().optional(),
});

const fileEntrySchema = z.object({
	name: z.string(),
	path: z.string(),
	type: z.enum(["directory", "file"]),
	size: z.number().optional(),
	modifiedAt: z.number().optional(),
});

const directoryEntrySchema = z.object({
	name: z.string(),
	path: z.string(),
	type: z.literal("directory"),
	size: z.undefined().optional(),
	modifiedAt: z.number().optional(),
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
	z.object({ name: z.literal("volume.testConnection"), backendConfig: z.record(z.string(), z.unknown()) }),
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
	z.object({
		name: z.literal("volume.listFiles"),
		result: z.object({
			files: z.array(fileEntrySchema),
			path: z.string(),
			offset: z.number(),
			limit: z.number(),
			total: z.number(),
			hasMore: z.boolean(),
		}),
	}),
	z.object({
		name: z.literal("volume.testConnection"),
		result: z.object({ success: z.boolean(), message: z.string() }),
	}),
	z.object({
		name: z.literal("filesystem.browse"),
		result: z.object({ directories: z.array(directoryEntrySchema), path: z.string() }),
	}),
]);

const volumeCommandResponseSchema = z.object({
	type: z.literal("volume.commandResult"),
	payload: z.discriminatedUnion("status", [
		z.object({ commandId: z.string(), status: z.literal("success"), command: volumeCommandResultSchema }),
		z.object({ commandId: z.string(), status: z.literal("error"), error: z.string() }),
	]),
});

const heartbeatPingSchema = z.object({
	type: z.literal("heartbeat.ping"),
	payload: z.object({ sentAt: z.number() }),
});

const agentReadySchema = z.object({
	type: z.literal("agent.ready"),
	payload: z.object({ agentId: z.string() }),
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
