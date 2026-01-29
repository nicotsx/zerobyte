import { type } from "arktype";

export const BACKEND_TYPES = {
	nfs: "nfs",
	smb: "smb",
	directory: "directory",
	webdav: "webdav",
	rclone: "rclone",
	sftp: "sftp",
} as const;

export type BackendType = keyof typeof BACKEND_TYPES;

export const nfsConfigSchema = type({
	backend: "'nfs'",
	server: "string",
	exportPath: "string",
	port: type("string.integer").or(type("number")).to("1 <= number <= 65536").default(2049),
	version: "'3' | '4' | '4.1'",
	readOnly: "boolean?",
});

export const smbConfigSchema = type({
	backend: "'smb'",
	server: "string",
	share: "string",
	username: "string?",
	password: "string?",
	guest: "boolean?",
	vers: type("'1.0' | '2.0' | '2.1' | '3.0' | 'auto'").default("auto"),
	domain: "string?",
	port: type("string.integer").or(type("number")).to("1 <= number <= 65535").default(445),
	readOnly: "boolean?",
});

export const directoryConfigSchema = type({
	backend: "'directory'",
	path: "string",
	readOnly: "false?",
});

export const webdavConfigSchema = type({
	backend: "'webdav'",
	server: "string",
	path: "string",
	username: "string?",
	password: "string?",
	port: type("string.integer").or(type("number")).to("1 <= number <= 65536").default(80),
	readOnly: "boolean?",
	ssl: "boolean?",
});

export const rcloneConfigSchema = type({
	backend: "'rclone'",
	remote: "string",
	path: "string",
	readOnly: "boolean?",
});

export const sftpConfigSchema = type({
	backend: "'sftp'",
	host: "string",
	port: type("string.integer").or(type("number")).to("1 <= number <= 65535").default(22),
	username: "string",
	password: "string?",
	privateKey: "string?",
	path: "string",
	readOnly: "boolean?",
	skipHostKeyCheck: "boolean = true",
	knownHosts: "string?",
});

export const volumeConfigSchemaBase = nfsConfigSchema
	.or(smbConfigSchema)
	.or(webdavConfigSchema)
	.or(directoryConfigSchema)
	.or(rcloneConfigSchema)
	.or(sftpConfigSchema);

export const volumeConfigSchema = volumeConfigSchemaBase.onUndeclaredKey("delete");

export type BackendConfig = typeof volumeConfigSchema.infer;

export const BACKEND_STATUS = {
	mounted: "mounted",
	unmounted: "unmounted",
	error: "error",
} as const;

export type BackendStatus = keyof typeof BACKEND_STATUS;
