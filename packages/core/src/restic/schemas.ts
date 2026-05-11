import { z } from "zod";

export const REPOSITORY_BACKENDS = {
	local: "local",
	s3: "s3",
	r2: "r2",
	b2: "b2",
	gcs: "gcs",
	azure: "azure",
	rclone: "rclone",
	rest: "rest",
	sftp: "sftp",
} as const;

export type RepositoryBackend = keyof typeof REPOSITORY_BACKENDS;

export const BANDWIDTH_UNITS = {
	Kbps: "Kbps",
	Mbps: "Mbps",
	Gbps: "Gbps",
} as const;

export type BandwidthUnit = keyof typeof BANDWIDTH_UNITS;

const bandwidthUnitSchema = z.enum(["Kbps", "Mbps", "Gbps"]);

export const bandwidthLimitSchema = z.object({
	enabled: z.boolean().default(false),
	value: z.number().positive().default(1),
	unit: bandwidthUnitSchema.default("Mbps"),
});

export type BandwidthLimit = z.infer<typeof bandwidthLimitSchema>;

const baseRepositoryConfigSchema = z.object({
	isExistingRepository: z.boolean().optional(),
	customPassword: z.string().optional(),
	cacert: z.string().optional(),
	insecureTls: z.boolean().optional(),
	uploadLimit: bandwidthLimitSchema.optional(),
	downloadLimit: bandwidthLimitSchema.optional(),
});

export const s3RepositoryConfigSchema = z
	.object({
		backend: z.literal("s3"),
		endpoint: z.string().min(1),
		bucket: z.string().min(1),
		accessKeyId: z.string().min(1),
		secretAccessKey: z.string().min(1),
	})
	.extend(baseRepositoryConfigSchema.shape);

export const b2RepositoryConfigSchema = z
	.object({
		backend: z.literal("b2"),
		bucket: z.string().min(1),
		path: z.string().min(1),
		accountId: z.string().min(1),
		accountKey: z.string().min(1),
	})
	.extend(baseRepositoryConfigSchema.shape);

export const r2RepositoryConfigSchema = z
	.object({
		backend: z.literal("r2"),
		endpoint: z.string().min(1),
		bucket: z.string().min(1),
		accessKeyId: z.string().min(1),
		secretAccessKey: z.string().min(1),
	})
	.extend(baseRepositoryConfigSchema.shape);

export const localRepositoryConfigSchema = z
	.object({
		backend: z.literal("local"),
		path: z.string().min(1),
	})
	.extend(baseRepositoryConfigSchema.shape);

export const gcsRepositoryConfigSchema = z
	.object({
		backend: z.literal("gcs"),
		bucket: z.string().min(1),
		projectId: z.string().min(1),
		credentialsJson: z.string().min(1),
	})
	.extend(baseRepositoryConfigSchema.shape);

export const azureRepositoryConfigSchema = z
	.object({
		backend: z.literal("azure"),
		container: z.string().min(1),
		accountName: z.string().min(1),
		accountKey: z.string().min(1),
		endpointSuffix: z.string().optional(),
	})
	.extend(baseRepositoryConfigSchema.shape);

export const rcloneRepositoryConfigSchema = z
	.object({
		backend: z.literal("rclone"),
		remote: z.string().min(1),
		path: z.string().min(1),
	})
	.extend(baseRepositoryConfigSchema.shape);

export const restRepositoryConfigSchema = z
	.object({
		backend: z.literal("rest"),
		url: z.string().min(1),
		username: z.string().optional(),
		password: z.string().optional(),
		path: z.string().optional(),
	})
	.extend(baseRepositoryConfigSchema.shape);

export const sftpRepositoryConfigSchema = z
	.object({
		backend: z.literal("sftp"),
		host: z.string().min(1),
		port: z
			.union([z.string(), z.number()])
			.transform((value) => (typeof value === "string" ? Number.parseInt(value, 10) : value))
			.pipe(z.number().int().min(1).max(65535))
			.default(22),
		user: z.string().min(1),
		path: z.string().min(1),
		privateKey: z.string().min(1),
		skipHostKeyCheck: z.boolean().default(false),
		knownHosts: z.string().optional(),
	})
	.extend(baseRepositoryConfigSchema.shape);

export const repositoryConfigSchemaBase = z.discriminatedUnion("backend", [
	s3RepositoryConfigSchema,
	r2RepositoryConfigSchema,
	b2RepositoryConfigSchema,
	localRepositoryConfigSchema,
	gcsRepositoryConfigSchema,
	azureRepositoryConfigSchema,
	rcloneRepositoryConfigSchema,
	restRepositoryConfigSchema,
	sftpRepositoryConfigSchema,
]);

export const repositoryConfigSchema = repositoryConfigSchemaBase;

export type RepositoryConfig = z.infer<typeof repositoryConfigSchema>;

export const COMPRESSION_MODES = {
	off: "off",
	auto: "auto",
	max: "max",
} as const;

export type CompressionMode = keyof typeof COMPRESSION_MODES;

export const REPOSITORY_STATUS = {
	healthy: "healthy",
	error: "error",
	unknown: "unknown",
	doctor: "doctor",
	cancelled: "cancelled",
} as const;

export type RepositoryStatus = keyof typeof REPOSITORY_STATUS;

export const doctorStepSchema = z.object({
	step: z.string(),
	success: z.boolean(),
	output: z.string().nullable(),
	error: z.string().nullable(),
});

export type DoctorStep = z.infer<typeof doctorStepSchema>;

export const doctorResultSchema = z.object({
	success: z.boolean(),
	steps: doctorStepSchema.array(),
	completedAt: z.number(),
});

export type DoctorResult = z.infer<typeof doctorResultSchema>;

export const OVERWRITE_MODES = {
	always: "always",
	ifChanged: "if-changed",
	ifNewer: "if-newer",
	never: "never",
} as const;

export type OverwriteMode = (typeof OVERWRITE_MODES)[keyof typeof OVERWRITE_MODES];
