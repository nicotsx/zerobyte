import { type } from "arktype";

export const REPOSITORY_BACKENDS = {
	local: "local",
	s3: "s3",
	r2: "r2",
	gcs: "gcs",
	azure: "azure",
	rclone: "rclone",
	rest: "rest",
	sftp: "sftp",
} as const;

export type RepositoryBackend = keyof typeof REPOSITORY_BACKENDS;

// Common fields for all repository configs
export const baseRepositoryConfigShape = {
	isExistingRepository: "boolean?",
	customPassword: "string?",
} as const;

const baseRepositoryConfigSchema = type(baseRepositoryConfigShape);

export const s3RepositoryConfigShape = {
	backend: "'s3'",
	endpoint: "string",
	bucket: "string",
	accessKeyId: "string",
	secretAccessKey: "string",
} as const;

export const s3RepositoryConfigSchema = type(s3RepositoryConfigShape).and(baseRepositoryConfigSchema);

export const r2RepositoryConfigShape = {
	backend: "'r2'",
	endpoint: "string",
	bucket: "string",
	accessKeyId: "string",
	secretAccessKey: "string",
} as const;

export const r2RepositoryConfigSchema = type(r2RepositoryConfigShape).and(baseRepositoryConfigSchema);

export const localRepositoryConfigShape = {
	backend: "'local'",
	name: "string",
	path: "string?",
} as const;

export const localRepositoryConfigSchema = type(localRepositoryConfigShape).and(baseRepositoryConfigSchema);

export const gcsRepositoryConfigShape = {
	backend: "'gcs'",
	bucket: "string",
	projectId: "string",
	credentialsJson: "string",
} as const;

export const gcsRepositoryConfigSchema = type(gcsRepositoryConfigShape).and(baseRepositoryConfigSchema);

export const azureRepositoryConfigShape = {
	backend: "'azure'",
	container: "string",
	accountName: "string",
	accountKey: "string",
	endpointSuffix: "string?",
} as const;

export const azureRepositoryConfigSchema = type(azureRepositoryConfigShape).and(baseRepositoryConfigSchema);

export const rcloneRepositoryConfigShape = {
	backend: "'rclone'",
	remote: "string",
	path: "string",
} as const;

export const rcloneRepositoryConfigSchema = type(rcloneRepositoryConfigShape).and(baseRepositoryConfigSchema);

export const restRepositoryConfigShape = {
	backend: "'rest'",
	url: "string",
	username: "string?",
	password: "string?",
	path: "string?",
} as const;

export const restRepositoryConfigSchema = type(restRepositoryConfigShape).and(baseRepositoryConfigSchema);

export const sftpRepositoryConfigShape = {
	backend: "'sftp'",
	host: "string",
	port: type("string.integer").or(type("number")).to("1 <= number <= 65535").default(22),
	user: "string",
	path: "string",
	privateKey: "string",
} as const;

export const sftpRepositoryConfigSchema = type(sftpRepositoryConfigShape).and(baseRepositoryConfigSchema);

export const repositoryConfigSchema = s3RepositoryConfigSchema
	.or(r2RepositoryConfigSchema)
	.or(localRepositoryConfigSchema)
	.or(gcsRepositoryConfigSchema)
	.or(azureRepositoryConfigSchema)
	.or(rcloneRepositoryConfigSchema)
	.or(restRepositoryConfigSchema)
	.or(sftpRepositoryConfigSchema);

export type RepositoryConfig = typeof repositoryConfigSchema.infer;

export const REPOSITORY_CONFIG_SHAPES = {
	local: { ...baseRepositoryConfigShape, ...localRepositoryConfigShape },
	s3: { ...baseRepositoryConfigShape, ...s3RepositoryConfigShape },
	r2: { ...baseRepositoryConfigShape, ...r2RepositoryConfigShape },
	gcs: { ...baseRepositoryConfigShape, ...gcsRepositoryConfigShape },
	azure: { ...baseRepositoryConfigShape, ...azureRepositoryConfigShape },
	rclone: { ...baseRepositoryConfigShape, ...rcloneRepositoryConfigShape },
	rest: { ...baseRepositoryConfigShape, ...restRepositoryConfigShape },
	sftp: { ...baseRepositoryConfigShape, ...sftpRepositoryConfigShape },
} as const;

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
} as const;

export type RepositoryStatus = keyof typeof REPOSITORY_STATUS;

export const OVERWRITE_MODES = {
	always: "always",
	ifChanged: "if-changed",
	ifNewer: "if-newer",
	never: "never",
} as const;

export type OverwriteMode = (typeof OVERWRITE_MODES)[keyof typeof OVERWRITE_MODES];
