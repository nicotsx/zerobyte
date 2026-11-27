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
} from "@zerobyte/core/restic";
import {
	browseFilesystemResponseSchema,
	listVolumeFilesResponseSchema,
	statfsSchema,
	trustedRootDescriptorSchema,
	filesystemSourceSchema,
} from "./volumes";

const agentSelfUpdateSchema = z.literal("systemd");
export const agentProtocolVersionSchema = z.int().nonnegative();

const compressionModeSchema = z.enum(["off", "auto", "max"]) satisfies z.ZodType<CompressionMode>;

export const AGENT_PROTOCOL_VERSION = 2;
export const SUPPORTED_AGENT_PROTOCOL_MIN_VERSION = AGENT_PROTOCOL_VERSION;
export const SUPPORTED_AGENT_PROTOCOL_MAX_VERSION = AGENT_PROTOCOL_VERSION;
export const MAX_AGENT_TRUSTED_ROOTS = 100;

export type AgentProtocolRejectionReason =
	"agent_too_old" | "agent_too_new" | "invalid_agent_ready" | "unexpected_startup_message" | "invalid_startup_json";

export type AgentProtocolRejection = {
	reason: AgentProtocolRejectionReason;
	protocolVersion?: number;
	supportedProtocolMinVersion: number;
	supportedProtocolMaxVersion: number;
	agentVersion?: string;
	selfUpdate?: z.infer<typeof agentSelfUpdateSchema>;
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
		source: filesystemSourceSchema,
		repositoryConfig: repositoryConfigSchema,
		options: backupExecutionOptionsSchema,
		runtime: commandRuntimeSchema,
		webhooks: backupWebhooksSchema,
		webhookAllowedOrigins: z.array(z.string()).nullable(),
		webhookTimeoutMs: z.number(),
	}),
});

const backupCancelSchema = z.object({
	type: z.literal("backup.cancel"),
	payload: z.object({ jobId: z.string(), scheduleId: z.string() }),
});

const filesystemCommandSchema = z.discriminatedUnion("name", [
	z.object({ name: z.literal("filesystem.statfs"), source: filesystemSourceSchema }),
	z.object({
		name: z.literal("filesystem.listFiles"),
		source: filesystemSourceSchema,
		subPath: z.string().optional(),
		offset: z.number(),
		limit: z.number(),
	}),
	z.object({ name: z.literal("filesystem.browse"), source: filesystemSourceSchema }),
]);

const filesystemCommandRequestSchema = z.object({
	type: z.literal("filesystem.command"),
	payload: z.object({ commandId: z.string(), command: filesystemCommandSchema }),
});

const filesystemCommandResultSchema = z.discriminatedUnion("name", [
	z.object({ name: z.literal("filesystem.statfs"), result: statfsSchema }),
	z.object({ name: z.literal("filesystem.listFiles"), result: listVolumeFilesResponseSchema }),
	z.object({ name: z.literal("filesystem.browse"), result: browseFilesystemResponseSchema }),
]);

const filesystemCommandResponseSchema = z.object({
	type: z.literal("filesystem.commandResult"),
	payload: z.discriminatedUnion("status", [
		z.object({ commandId: z.string(), status: z.literal("success"), command: filesystemCommandResultSchema }),
		z.object({ commandId: z.string(), status: z.literal("error"), error: z.string() }),
	]),
});

const restoreIdentitySchema = z.object({
	restoreId: z.string(),
	organizationId: z.string(),
	repositoryId: z.string(),
	snapshotId: z.string(),
});

const restoreRunSchema = z.object({
	type: z.literal("restore.run"),
	payload: restoreIdentitySchema.extend({
		target: z.string(),
		repositoryConfig: repositoryConfigSchema,
		runtime: commandRuntimeSchema,
		options: z.object({
			basePath: z.string().optional(),
			organizationId: z.string(),
			include: z.array(z.string()).optional(),
			selectedItemKind: z.enum(["file", "dir"]).optional(),
			exclude: z.array(z.string()).optional(),
			excludeXattr: z.array(z.string()).optional(),
			delete: z.boolean().optional(),
			overwrite: z.enum(["always", "if-changed", "if-newer", "never"]).optional(),
		}),
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

export const agentCapabilitiesSchema = z
	.object({
		hostname: z.string().optional(),
		platform: z.string().optional(),
		agentVersion: z.string().optional(),
		resticVersion: z.string().optional(),
		restore: z.boolean().optional(),
		selfUpdate: agentSelfUpdateSchema.optional().catch(undefined),
		updateTrial: z
			.object({ requestId: z.uuid(), attemptId: z.uuid(), locallyAccepted: z.literal(true).optional() })
			.optional()
			.catch(undefined),
		trustedRoots: z.array(trustedRootDescriptorSchema).max(MAX_AGENT_TRUSTED_ROOTS).optional(),
	})
	.catchall(z.unknown());

export type AgentCapabilities = z.infer<typeof agentCapabilitiesSchema>;

const agentReadySchema = z.object({
	type: z.literal("agent.ready"),
	payload: z.object({
		agentId: z.string(),
		protocolVersion: agentProtocolVersionSchema,
		hostname: z.string(),
		platform: z.string(),
		capabilities: agentCapabilitiesSchema,
	}),
});

const agentMessageEnvelopeSchema = z.object({ type: z.string() });

const stableAgentReadySchema = z.object({
	type: z.literal("agent.ready"),
	payload: z.object({
		protocolVersion: agentProtocolVersionSchema,
		hostname: z.string().optional().catch(undefined),
		platform: z.string().optional().catch(undefined),
		capabilities: z
			.object({
				agentVersion: z.string().max(129).optional().catch(undefined),
				selfUpdate: agentSelfUpdateSchema.optional().catch(undefined),
			})
			.optional()
			.catch(undefined),
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
	filesystemCommandRequestSchema,
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
	filesystemCommandResponseSchema,
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
export type FilesystemCommandPayload = z.infer<typeof filesystemCommandRequestSchema>["payload"];
export type FilesystemCommand = z.infer<typeof filesystemCommandSchema>;
export type FilesystemCommandResult = z.infer<typeof filesystemCommandResultSchema>;
export type FilesystemCommandResponsePayload = z.infer<typeof filesystemCommandResponseSchema>["payload"];
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

const validateAgentMessage = (message: unknown) => (message === null ? null : agentMessageSchema.safeParse(message));

export const parseAgentMessage = (data: string) => validateAgentMessage(safeJsonParse<unknown>(data));

export function decodeAgentFrame(data: string) {
	const json = safeJsonParse<unknown>(data);
	const message = validateAgentMessage(json);
	const type = message?.success ? message.data.type : agentMessageEnvelopeSchema.safeParse(json).data?.type;

	const ready = type === "agent.ready" ? stableAgentReadySchema.safeParse(json) : null;

	return { message, type, ready };
}

export type AgentFrame = ReturnType<typeof decodeAgentFrame>;

export function getAgentStartupRejection({ message, type, ready }: AgentFrame): AgentProtocolRejection | null {
	const supported = {
		supportedProtocolMinVersion: SUPPORTED_AGENT_PROTOCOL_MIN_VERSION,
		supportedProtocolMaxVersion: SUPPORTED_AGENT_PROTOCOL_MAX_VERSION,
	};

	if (message === null) return { ...supported, reason: "invalid_startup_json" };
	if (type !== "agent.ready") return { ...supported, reason: "unexpected_startup_message", messageType: type };

	if (!ready?.success) return { ...supported, reason: "invalid_agent_ready" };

	const { protocolVersion, hostname, platform, capabilities } = ready.data.payload;
	const { supportedProtocolMinVersion, supportedProtocolMaxVersion } = supported;

	let reason: AgentProtocolRejectionReason;
	if (protocolVersion < supportedProtocolMinVersion) reason = "agent_too_old";
	else if (protocolVersion > supportedProtocolMaxVersion) reason = "agent_too_new";
	else return message.success ? null : { ...supported, reason: "invalid_agent_ready" };

	return {
		...supported,
		reason,
		protocolVersion,
		agentVersion: capabilities?.agentVersion,
		selfUpdate: capabilities?.selfUpdate,
		hostname,
		platform,
	};
}

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
