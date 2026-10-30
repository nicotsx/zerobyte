import { z } from "zod";

const rcloneRemoteNamePattern = /^[\p{L}\p{N}_.+@](?:[\p{L}\p{N}_.+@ -]*[\p{L}\p{N}_.+@-])?$/u;

export const rcloneRemoteNameSchema = z
	.string()
	.regex(rcloneRemoteNamePattern, "Rclone remote must be a configured remote name");

export const buildRcloneRemotePath = (remote: string, path: string) => {
	const name = rcloneRemoteNameSchema.parse(remote);
	return `${name}:${path}`;
};
