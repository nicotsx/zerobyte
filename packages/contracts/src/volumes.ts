import { z } from "zod";

export const BACKEND_TYPES = {
	nfs: "nfs",
	smb: "smb",
	directory: "directory",
	webdav: "webdav",
	rclone: "rclone",
	sftp: "sftp",
} as const;

export type BackendType = keyof typeof BACKEND_TYPES;

export const nfsConfigSchema = z.object({
	backend: z.literal("nfs"),
	server: z.string().min(1),
	exportPath: z.string().min(1),
	port: z
		.union([z.string(), z.number()])
		.transform((value) => (typeof value === "string" ? Number.parseInt(value, 10) : value))
		.pipe(z.number().int().min(1).max(65535))
		.default(2049),
	version: z.enum(["3", "4", "4.1"]),
	readOnly: z.boolean().optional(),
});

export const smbConfigSchema = z.object({
	backend: z.literal("smb"),
	server: z.string().min(1),
	share: z.string().min(1),
	username: z.string().optional(),
	password: z.string().optional(),
	guest: z.boolean().optional(),
	mapToContainerUidGid: z.boolean().default(false),
	vers: z.enum(["1.0", "2.0", "2.1", "3.0", "auto"]).default("auto"),
	domain: z.string().optional(),
	port: z
		.union([z.string(), z.number()])
		.transform((value) => (typeof value === "string" ? Number.parseInt(value, 10) : value))
		.pipe(z.number().int().min(1).max(65535))
		.default(445),
	readOnly: z.boolean().optional(),
});

export const directoryConfigSchema = z.object({
	backend: z.literal("directory"),
	path: z.string().min(1),
	readOnly: z.literal(false).optional(),
});

export const webdavConfigSchema = z.object({
	backend: z.literal("webdav"),
	server: z.string().min(1),
	path: z.string().min(1),
	username: z.string().optional(),
	password: z.string().optional(),
	port: z
		.union([z.string(), z.number()])
		.transform((value) => (typeof value === "string" ? Number.parseInt(value, 10) : value))
		.pipe(z.number().int().min(1).max(65535))
		.default(80),
	readOnly: z.boolean().optional(),
	ssl: z.boolean().optional(),
});

export const rcloneConfigSchema = z.object({
	backend: z.literal("rclone"),
	remote: z.string().min(1),
	path: z.string().min(1),
	readOnly: z.boolean().optional(),
});

export const sftpConfigSchema = z.object({
	backend: z.literal("sftp"),
	host: z.string().min(1),
	port: z
		.union([z.string(), z.number()])
		.transform((value) => (typeof value === "string" ? Number.parseInt(value, 10) : value))
		.pipe(z.number().int().min(1).max(65535))
		.default(22),
	username: z.string().min(1),
	password: z.string().optional(),
	privateKey: z.string().optional(),
	path: z.string().min(1),
	readOnly: z.boolean().optional(),
	skipHostKeyCheck: z.boolean().default(false),
	knownHosts: z.string().optional(),
	allowLegacySshRsa: z.boolean().default(false),
	allowUnsafeSymlinkTargets: z.boolean().default(false),
});

export const volumeConfigSchema = z
	.discriminatedUnion("backend", [
		nfsConfigSchema,
		smbConfigSchema,
		webdavConfigSchema,
		directoryConfigSchema,
		rcloneConfigSchema,
		sftpConfigSchema,
	])
	.superRefine((value, ctx) => {
		if (
			value.backend === "sftp" &&
			value.allowUnsafeSymlinkTargets &&
			(value.skipHostKeyCheck || !value.knownHosts?.trim())
		) {
			ctx.addIssue({
				code: "custom",
				message: "Unsafe symlink targets require host key verification with known hosts",
				path: ["allowUnsafeSymlinkTargets"],
			});
		}
	});

export type BackendConfig = z.infer<typeof volumeConfigSchema>;

export const trustedRootIdSchema = z
	.string()
	.trim()
	.min(1)
	.max(64)
	.regex(
		/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/,
		"Trusted root IDs may only contain letters, numbers, dots, underscores, and hyphens",
	);

export const trustedRootDescriptorSchema = z.object({
	id: trustedRootIdSchema,
	label: z.string().trim().min(1).max(128),
	canBackup: z.boolean(),
});

export type TrustedRootDescriptor = z.infer<typeof trustedRootDescriptorSchema>;

export const trustedSourceReferenceSchema = z.object({
	rootId: trustedRootIdSchema,
	relativePath: z.string(),
});

export type TrustedSourceReference = z.infer<typeof trustedSourceReferenceSchema>;

export const TRUSTED_ROOT_PATH_PREFIX = "trusted-root:";

export const encodeTrustedPathPresentation = (rawRelativePath: string, rootSafe: boolean) => {
	const portablePath = rawRelativePath.replaceAll("\\", "/").replace(/^\/+/, "");

	if (rootSafe) {
		return `${TRUSTED_ROOT_PATH_PREFIX}${portablePath}`;
	}

	return portablePath ? `/${portablePath}` : "/";
};

export const decodeTrustedPathPresentation = (presentedPath: string) => {
	const logicalPath = presentedPath.startsWith(TRUSTED_ROOT_PATH_PREFIX)
		? presentedPath.slice(TRUSTED_ROOT_PATH_PREFIX.length)
		: presentedPath;

	return logicalPath.replace(/^\/+/, "");
};

export const normalizeTrustedSourceRelativePath = (rawPath: string) => {
	if (rawPath.includes("\0")) {
		throw new Error("Trusted source path contains a null byte");
	}

	if (rawPath.includes("\\")) {
		throw new Error("Trusted source path contains an invalid separator");
	}

	if (rawPath.startsWith("/") || /^[a-zA-Z]:/.test(rawPath)) {
		throw new Error("Trusted source path must be relative");
	}

	const segments = rawPath.split("/");

	if (segments.some((segment) => segment === "..")) {
		throw new Error("Trusted source path cannot traverse outside its root");
	}

	return segments.filter((segment) => segment !== "" && segment !== ".").join("/");
};

export const trustedSourceInputSchema = z.object({
	sourceKind: z.literal("agent-filesystem"),
	agentId: z.string().min(1),
	trustedRootId: trustedRootIdSchema,
	relativePath: z
		.string()
		.transform((value, ctx) => {
			try {
				return normalizeTrustedSourceRelativePath(value);
			} catch (error) {
				ctx.addIssue({
					code: "custom",
					message: error instanceof Error ? error.message : "Invalid trusted source path",
				});
				return z.NEVER;
			}
		})
		.default(""),
});

export const BACKEND_STATUS = {
	mounted: "mounted",
	unmounted: "unmounted",
	error: "error",
} as const;

export type BackendStatus = keyof typeof BACKEND_STATUS;

export const backendStatusSchema = z.enum(BACKEND_STATUS);

const volumeBaseSchema = z.object({
	id: z.number(),
	shortId: z.string(),
	name: z.string(),
	path: z.string().nullable().optional(),
	config: volumeConfigSchema.nullable(),
	createdAt: z.number(),
	updatedAt: z.number(),
	lastHealthCheck: z.number(),
	type: z.enum(BACKEND_TYPES).nullable(),
	status: backendStatusSchema,
	lastError: z.string().nullable(),
	provisioningId: z.string().nullable().optional(),
	autoRemount: z.boolean(),
	agentId: z.string(),
	organizationId: z.string(),
});

export const managedVolumeSchema = volumeBaseSchema.extend({
	sourceKind: z.literal("managed"),
	config: volumeConfigSchema,
	type: z.enum(BACKEND_TYPES),
	trustedRootId: z.null(),
	relativePath: z.null(),
});

export const agentFilesystemVolumeSchema = volumeBaseSchema.extend({
	sourceKind: z.literal("agent-filesystem"),
	config: z.null(),
	type: z.null(),
	trustedRootId: trustedRootIdSchema,
	relativePath: z.string(),
});

export const volumeSchema = z.discriminatedUnion("sourceKind", [managedVolumeSchema, agentFilesystemVolumeSchema]);

export type Volume = z.infer<typeof volumeSchema>;

export const managedVolumeExecutionSourceSchema = z.object({
	kind: z.literal("managed"),
	volume: managedVolumeSchema,
});

export const trustedFilesystemExecutionSourceSchema = z.object({
	kind: z.literal("agent-filesystem"),
	reference: trustedSourceReferenceSchema,
});

export const volumeExecutionSourceSchema = z.discriminatedUnion("kind", [
	managedVolumeExecutionSourceSchema,
	trustedFilesystemExecutionSourceSchema,
]);

export type VolumeExecutionSource = z.infer<typeof volumeExecutionSourceSchema>;

export const sourceMachineStatusSchema = z.enum(["offline", "connecting", "online", "degraded"]);

export const sourceLocationAvailabilitySchema = z.enum([
	"available",
	"offline",
	"connecting",
	"degraded",
	"revoked",
	"missing-agent",
	"root-removed",
	"incompatible",
	"backup-disabled",
	"not-ready",
]);

export const sourceTrustedRootSchema = trustedRootDescriptorSchema;

export const sourceMachineSchema = z.object({
	id: z.string(),
	name: z.string(),
	status: sourceMachineStatusSchema,
	lastSeenAt: z.number().nullable(),
	revokedAt: z.number().nullable(),
	trustedRoots: z.array(sourceTrustedRootSchema),
	availability: sourceLocationAvailabilitySchema,
});

export const sourceLocationSchema = z.object({
	machine: sourceMachineSchema.omit({ trustedRoots: true, availability: true }),
	root: sourceTrustedRootSchema,
	relativePath: z.string(),
	availability: sourceLocationAvailabilitySchema,
});

export type SourceMachine = z.infer<typeof sourceMachineSchema>;
export type SourceLocation = z.infer<typeof sourceLocationSchema>;
export type SourceTrustedRoot = z.infer<typeof sourceTrustedRootSchema>;

const publicManagedVolumeSchema = managedVolumeSchema.omit({ organizationId: true, path: true });
const publicAgentFilesystemVolumeSchema = agentFilesystemVolumeSchema.omit({ organizationId: true, path: true });

export const publicVolumeSchema = z.discriminatedUnion("sourceKind", [
	publicManagedVolumeSchema,
	publicAgentFilesystemVolumeSchema,
]);

export type PublicVolume = z.infer<typeof publicVolumeSchema>;

const presentedManagedVolumeSchema = publicManagedVolumeSchema.extend({ sourceLocation: z.null() });
const presentedAgentFilesystemVolumeSchema = publicAgentFilesystemVolumeSchema.extend({
	sourceLocation: sourceLocationSchema,
});

export const presentedVolumeSchema = z.discriminatedUnion("sourceKind", [
	presentedManagedVolumeSchema,
	presentedAgentFilesystemVolumeSchema,
]);

export type PresentedVolume = z.infer<typeof presentedVolumeSchema>;

const presentedManagedVolumeDetailSchema = presentedManagedVolumeSchema.extend({ path: z.string() });
const presentedAgentFilesystemVolumeDetailSchema = presentedAgentFilesystemVolumeSchema.extend({ path: z.string() });

export const presentedVolumeDetailSchema = z.discriminatedUnion("sourceKind", [
	presentedManagedVolumeDetailSchema,
	presentedAgentFilesystemVolumeDetailSchema,
]);

export type PresentedVolumeDetail = z.infer<typeof presentedVolumeDetailSchema>;

export const volumeOperationResultSchema = z.object({
	status: backendStatusSchema,
	error: z.string().optional(),
});

export type VolumeOperationResult = z.infer<typeof volumeOperationResultSchema>;

export const statfsSchema = z.object({
	total: z.number().optional(),
	used: z.number().optional(),
	free: z.number().optional(),
});

export const fileEntrySchema = z.object({
	name: z.string(),
	path: z.string(),
	type: z.enum(["directory", "file"]),
	size: z.number().optional(),
	modifiedAt: z.number().optional(),
});

export const directoryEntrySchema = fileEntrySchema.extend({
	type: z.literal("directory"),
	size: z.undefined().optional(),
});

export const listVolumeFilesResponseSchema = z.object({
	files: z.array(fileEntrySchema),
	path: z.string(),
	offset: z.number(),
	limit: z.number(),
	total: z.number(),
	hasMore: z.boolean(),
});

export const testVolumeConnectionResponseSchema = z.object({
	success: z.boolean(),
	message: z.string(),
});

export const browseFilesystemResponseSchema = z.object({
	directories: z.array(directoryEntrySchema),
	path: z.string(),
});
