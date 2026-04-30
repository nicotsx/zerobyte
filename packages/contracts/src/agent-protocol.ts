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
	}),
});

const backupCancelSchema = z.object({
	type: z.literal("backup.cancel"),
	payload: z.object({ jobId: z.string(), scheduleId: z.string() }),
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
	heartbeatPingSchema,
]);
const agentMessageSchema = z.discriminatedUnion("type", [
	agentReadySchema,
	backupStartedSchema,
	backupProgressSchema,
	backupCompletedSchema,
	backupFailedSchema,
	backupCancelledSchema,
	heartbeatPongSchema,
]);

export type BackupRunPayload = z.infer<typeof backupRunSchema>["payload"];
export type BackupCancelPayload = z.infer<typeof backupCancelSchema>["payload"];
export type BackupStartedPayload = z.infer<typeof backupStartedSchema>["payload"];
export type BackupProgressPayload = z.infer<typeof backupProgressSchema>["payload"];
export type BackupCompletedPayload = z.infer<typeof backupCompletedSchema>["payload"];
export type BackupFailedPayload = z.infer<typeof backupFailedSchema>["payload"];
export type BackupCancelledPayload = z.infer<typeof backupCancelledSchema>["payload"];
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
