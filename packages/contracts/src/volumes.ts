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
});

export const volumeConfigSchema = z.discriminatedUnion("backend", [
	nfsConfigSchema,
	smbConfigSchema,
	webdavConfigSchema,
	directoryConfigSchema,
	rcloneConfigSchema,
	sftpConfigSchema,
]);

export type BackendConfig = z.infer<typeof volumeConfigSchema>;

export const BACKEND_STATUS = {
	mounted: "mounted",
	unmounted: "unmounted",
	error: "error",
} as const;

export type BackendStatus = keyof typeof BACKEND_STATUS;

export const backendStatusSchema = z.enum(BACKEND_STATUS);

export const volumeSchema = z.object({
	id: z.number(),
	shortId: z.string(),
	name: z.string(),
	path: z.string().nullable().optional(),
	config: volumeConfigSchema,
	createdAt: z.number(),
	updatedAt: z.number(),
	lastHealthCheck: z.number(),
	type: z.enum(BACKEND_TYPES),
	status: backendStatusSchema,
	lastError: z.string().nullable(),
	provisioningId: z.string().nullable().optional(),
	autoRemount: z.boolean(),
	agentId: z.string(),
	organizationId: z.string(),
});

export type Volume = z.infer<typeof volumeSchema>;

export const publicVolumeSchema = volumeSchema.omit({
	agentId: true,
	organizationId: true,
	path: true,
});

export type PublicVolume = z.infer<typeof publicVolumeSchema>;

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
