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
const baseRepositoryConfigSchema = type({
	isExistingRepository: "boolean?",
	customPassword: "string?",
});

export const s3RepositoryConfigSchema = type({
	backend: "'s3'",
	endpoint: "string",
	bucket: "string",
	accessKeyId: "string",
	secretAccessKey: "string",
}).and(baseRepositoryConfigSchema);

export const r2RepositoryConfigSchema = type({
	backend: "'r2'",
	endpoint: "string",
	bucket: "string",
	accessKeyId: "string",
	secretAccessKey: "string",
}).and(baseRepositoryConfigSchema);

export const localRepositoryConfigSchema = type({
	backend: "'local'",
	name: "string",
	path: "string?",
}).and(baseRepositoryConfigSchema);

export const gcsRepositoryConfigSchema = type({
	backend: "'gcs'",
	bucket: "string",
	projectId: "string",
	credentialsJson: "string",
}).and(baseRepositoryConfigSchema);

export const azureRepositoryConfigSchema = type({
	backend: "'azure'",
	container: "string",
	accountName: "string",
	accountKey: "string",
	endpointSuffix: "string?",
}).and(baseRepositoryConfigSchema);

export const rcloneRepositoryConfigSchema = type({
	backend: "'rclone'",
	remote: "string",
	path: "string",
}).and(baseRepositoryConfigSchema);

export const restRepositoryConfigSchema = type({
	backend: "'rest'",
	url: "string",
	username: "string?",
	password: "string?",
	path: "string?",
}).and(baseRepositoryConfigSchema);

export const sftpRepositoryConfigSchema = type({
	backend: "'sftp'",
	host: "string",
	port: type("string.integer").or(type("number")).to("1 <= number <= 65535").default(22),
	user: "string",
	path: "string",
	privateKey: "string",
}).and(baseRepositoryConfigSchema);

export const repositoryConfigSchemaBase = s3RepositoryConfigSchema
	.or(r2RepositoryConfigSchema)
	.or(localRepositoryConfigSchema)
	.or(gcsRepositoryConfigSchema)
	.or(azureRepositoryConfigSchema)
	.or(rcloneRepositoryConfigSchema)
	.or(restRepositoryConfigSchema)
	.or(sftpRepositoryConfigSchema);

export const repositoryConfigSchema = repositoryConfigSchemaBase.onUndeclaredKey("delete");

export type RepositoryConfig = typeof repositoryConfigSchema.infer;

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
