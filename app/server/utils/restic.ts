import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { throttle } from "es-toolkit";
import { type } from "arktype";
import { REPOSITORY_BASE, RESTIC_PASS_FILE, DEFAULT_EXCLUDES, RESTIC_CACHE_DIR } from "../core/constants";
import { config as appConfig } from "../core/config";
import { logger } from "./logger";
import { cryptoUtils } from "./crypto";
import type { RetentionPolicy } from "../modules/backups/backups.dto";
import { safeSpawn, exec } from "./spawn";
import type { CompressionMode, RepositoryConfig, OverwriteMode, BandwidthLimit } from "~/schemas/restic";
import { ResticError } from "./errors";
import { db } from "../db/db";

const backupOutputSchema = type({
	message_type: "'summary'",
	files_new: "number",
	files_changed: "number",
	files_unmodified: "number",
	dirs_new: "number",
	dirs_changed: "number",
	dirs_unmodified: "number",
	data_blobs: "number",
	tree_blobs: "number",
	data_added: "number",
	total_files_processed: "number",
	total_bytes_processed: "number",
	total_duration: "number",
	snapshot_id: "string",
});
export type BackupOutput = typeof backupOutputSchema.infer;

const snapshotInfoSchema = type({
	gid: "number?",
	hostname: "string",
	id: "string",
	parent: "string?",
	paths: "string[]",
	program_version: "string?",
	short_id: "string",
	time: "string",
	uid: "number?",
	username: "string?",
	tags: "string[]?",
	summary: type({
		backup_end: "string",
		backup_start: "string",
		data_added: "number",
		data_added_packed: "number",
		data_blobs: "number",
		dirs_changed: "number",
		dirs_new: "number",
		dirs_unmodified: "number",
		files_changed: "number",
		files_new: "number",
		files_unmodified: "number",
		total_bytes_processed: "number",
		total_files_processed: "number",
		tree_blobs: "number",
	}).optional(),
});

export const buildRepoUrl = (config: RepositoryConfig): string => {
	switch (config.backend) {
		case "local":
			if (config.isExistingRepository) {
				if (!config.path) throw new Error("Path is required for existing local repositories");
				return config.path;
			}

			return config.path ? `${config.path}/${config.name}` : `${REPOSITORY_BASE}/${config.name}`;
		case "s3":
			return `s3:${config.endpoint}/${config.bucket}`;
		case "r2": {
			const endpoint = config.endpoint.replace(/^https?:\/\//, "");
			return `s3:${endpoint}/${config.bucket}`;
		}
		case "gcs":
			return `gs:${config.bucket}:/`;
		case "azure":
			return `azure:${config.container}:/`;
		case "rclone":
			return `rclone:${config.remote}:${config.path}`;
		case "rest": {
			const path = config.path ? `/${config.path}` : "";
			return `rest:${config.url}${path}`;
		}
		case "sftp":
			return `sftp:${config.user}@${config.host}:${config.path}`;
		default: {
			throw new Error(`Unsupported repository backend: ${JSON.stringify(config)}`);
		}
	}
};

export const buildEnv = async (config: RepositoryConfig, organizationId: string) => {
	const env: Record<string, string> = {
		RESTIC_CACHE_DIR,
		PATH: process.env.PATH || "/usr/local/bin:/usr/bin:/bin",
	};

	if (config.isExistingRepository && config.customPassword) {
		const decryptedPassword = await cryptoUtils.resolveSecret(config.customPassword);
		const passwordFilePath = path.join("/tmp", `zerobyte-pass-${crypto.randomBytes(8).toString("hex")}.txt`);

		await fs.writeFile(passwordFilePath, decryptedPassword, { mode: 0o600 });
		env.RESTIC_PASSWORD_FILE = passwordFilePath;
	} else {
		const org = await db.query.organization.findFirst({ where: { id: organizationId } });

		if (!org) {
			throw new Error(`Organization ${organizationId} not found`);
		}

		const metadata = org.metadata;
		if (!metadata?.resticPassword) {
			throw new Error(`Restic password not configured for organization ${organizationId}`);
		} else {
			const decryptedPassword = await cryptoUtils.resolveSecret(metadata.resticPassword);
			const passwordFilePath = path.join("/tmp", `zerobyte-pass-${crypto.randomBytes(8).toString("hex")}.txt`);
			await fs.writeFile(passwordFilePath, decryptedPassword, { mode: 0o600 });
			env.RESTIC_PASSWORD_FILE = passwordFilePath;
		}
	}

	switch (config.backend) {
		case "s3":
			env.AWS_ACCESS_KEY_ID = await cryptoUtils.resolveSecret(config.accessKeyId);
			env.AWS_SECRET_ACCESS_KEY = await cryptoUtils.resolveSecret(config.secretAccessKey);

			// Huawei OBS requires virtual-hosted style access
			if (config.endpoint.includes("myhuaweicloud")) {
				env.AWS_S3_BUCKET_LOOKUP = "dns";
			}
			break;
		case "r2":
			env.AWS_ACCESS_KEY_ID = await cryptoUtils.resolveSecret(config.accessKeyId);
			env.AWS_SECRET_ACCESS_KEY = await cryptoUtils.resolveSecret(config.secretAccessKey);
			env.AWS_REGION = "auto";
			env.AWS_S3_FORCE_PATH_STYLE = "true";
			break;
		case "gcs": {
			const decryptedCredentials = await cryptoUtils.resolveSecret(config.credentialsJson);
			const credentialsPath = path.join("/tmp", `zerobyte-gcs-${crypto.randomBytes(8).toString("hex")}.json`);
			await fs.writeFile(credentialsPath, decryptedCredentials, { mode: 0o600 });
			env.GOOGLE_PROJECT_ID = config.projectId;
			env.GOOGLE_APPLICATION_CREDENTIALS = credentialsPath;
			break;
		}
		case "azure": {
			env.AZURE_ACCOUNT_NAME = config.accountName;
			env.AZURE_ACCOUNT_KEY = await cryptoUtils.resolveSecret(config.accountKey);
			if (config.endpointSuffix) {
				env.AZURE_ENDPOINT_SUFFIX = config.endpointSuffix;
			}
			break;
		}
		case "rest": {
			if (config.username) {
				env.RESTIC_REST_USERNAME = await cryptoUtils.resolveSecret(config.username);
			}
			if (config.password) {
				env.RESTIC_REST_PASSWORD = await cryptoUtils.resolveSecret(config.password);
			}
			break;
		}
		case "sftp": {
			const decryptedKey = await cryptoUtils.resolveSecret(config.privateKey);
			const keyPath = path.join("/tmp", `zerobyte-ssh-${crypto.randomBytes(8).toString("hex")}`);

			let normalizedKey = decryptedKey.replace(/\r\n/g, "\n");
			if (!normalizedKey.endsWith("\n")) {
				normalizedKey += "\n";
			}

			if (normalizedKey.includes("ENCRYPTED")) {
				logger.error("SFTP: Private key appears to be passphrase-protected. Please use an unencrypted key.");
				throw new Error("Passphrase-protected SSH keys are not supported. Please provide an unencrypted private key.");
			}

			await fs.writeFile(keyPath, normalizedKey, { mode: 0o600 });

			env._SFTP_KEY_PATH = keyPath;

			const sshArgs = [
				"-o",
				"LogLevel=ERROR",
				"-o",
				"BatchMode=yes",
				"-o",
				"NumberOfPasswordPrompts=0",
				"-o",
				"PreferredAuthentications=publickey",
				"-o",
				"PasswordAuthentication=no",
				"-o",
				"KbdInteractiveAuthentication=no",
				"-o",
				"IdentitiesOnly=yes",
				"-o",
				"ConnectTimeout=10",
				"-o",
				"ConnectionAttempts=1",
				"-o",
				"ServerAliveInterval=60",
				"-o",
				"ServerAliveCountMax=240",
				"-i",
				keyPath,
			];

			if (config.skipHostKeyCheck || !config.knownHosts) {
				sshArgs.push("-o", "StrictHostKeyChecking=no", "-o", "UserKnownHostsFile=/dev/null");
			} else if (config.knownHosts) {
				const knownHostsPath = path.join("/tmp", `zerobyte-known-hosts-${crypto.randomBytes(8).toString("hex")}`);
				await fs.writeFile(knownHostsPath, config.knownHosts, { mode: 0o600 });
				env._SFTP_KNOWN_HOSTS_PATH = knownHostsPath;
				sshArgs.push("-o", "StrictHostKeyChecking=yes", "-o", `UserKnownHostsFile=${knownHostsPath}`);
			}

			if (config.port && config.port !== 22) {
				sshArgs.push("-p", String(config.port));
			}

			env._SFTP_SSH_ARGS = sshArgs.join(" ");
			logger.info(`SFTP: SSH args: ${env._SFTP_SSH_ARGS}`);
			break;
		}
	}

	if (config.cacert) {
		const decryptedCert = await cryptoUtils.resolveSecret(config.cacert);
		const certPath = path.join("/tmp", `zerobyte-cacert-${crypto.randomBytes(8).toString("hex")}.pem`);
		await fs.writeFile(certPath, decryptedCert, { mode: 0o600 });
		env.RESTIC_CACERT = certPath;
	}

	if (config.insecureTls) {
		env._INSECURE_TLS = "true";
	}

	return env;
};

const init = async (config: RepositoryConfig, organizationId: string, options?: { timeoutMs?: number }) => {
	const repoUrl = buildRepoUrl(config);

	logger.info(`Initializing restic repository at ${repoUrl}...`);

	const env = await buildEnv(config, organizationId);

	const args = ["init", "--repo", repoUrl];

	args.push("--host", appConfig.resticHostname);
	addCommonArgs(args, env, config);

	const res = await exec({ command: "restic", args, env, timeout: options?.timeoutMs ?? 20000 });
	await cleanupTemporaryKeys(env);

	if (res.exitCode !== 0) {
		logger.error(`Restic init failed: ${res.stderr}`);
		return { success: false, error: res.stderr };
	}

	logger.info(`Restic repository initialized: ${repoUrl}`);
	return { success: true, error: null };
};

const backupProgressSchema = type({
	message_type: "'status'",
	seconds_elapsed: "number",
	percent_done: "number",
	total_files: "number",
	files_done: "number",
	total_bytes: "number",
	bytes_done: "number",
	current_files: "string[]",
});

export type BackupProgress = typeof backupProgressSchema.infer;

const backup = async (
	config: RepositoryConfig,
	source: string,
	options: {
		organizationId: string;
		exclude?: string[];
		excludeIfPresent?: string[];
		include?: string[];
		tags?: string[];
		oneFileSystem?: boolean;
		compressionMode?: CompressionMode;
		signal?: AbortSignal;
		onProgress?: (progress: BackupProgress) => void;
	},
) => {
	const repoUrl = buildRepoUrl(config);
	const env = await buildEnv(config, options?.organizationId);

	const args: string[] = ["--repo", repoUrl, "backup", "--compression", options?.compressionMode ?? "auto"];

	if (options?.oneFileSystem) {
		args.push("--one-file-system");
	}

	args.push("--host", appConfig.resticHostname);

	if (options?.tags && options.tags.length > 0) {
		for (const tag of options.tags) {
			args.push("--tag", tag);
		}
	}

	let includeFile: string | null = null;
	if (options?.include && options.include.length > 0) {
		const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "zerobyte-restic-include-"));
		includeFile = path.join(tmp, `include.txt`);

		await fs.writeFile(includeFile, options.include.join("\n"), "utf-8");

		args.push("--files-from", includeFile);
	} else {
		args.push(source);
	}

	for (const exclude of DEFAULT_EXCLUDES) {
		args.push("--exclude", exclude);
	}

	let excludeFile: string | null = null;
	if (options?.exclude && options.exclude.length > 0) {
		const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "zerobyte-restic-exclude-"));
		excludeFile = path.join(tmp, `exclude.txt`);

		await fs.writeFile(excludeFile, options.exclude.join("\n"), "utf-8");

		args.push("--exclude-file", excludeFile);
	}

	if (options?.excludeIfPresent && options.excludeIfPresent.length > 0) {
		for (const filename of options.excludeIfPresent) {
			args.push("--exclude-if-present", filename);
		}
	}

	addCommonArgs(args, env, config);

	const logData = throttle((data: string) => {
		logger.info(data.trim());
	}, 5000);

	const streamProgress = throttle((data: string) => {
		if (options?.onProgress) {
			try {
				const jsonData = JSON.parse(data);
				const progress = backupProgressSchema(jsonData);
				if (!(progress instanceof type.errors)) {
					options.onProgress(progress);
				}
			} catch (_) {
				// Ignore JSON parse errors for non-JSON lines
			}
		}
	}, 1000);

	logger.debug(`Executing: restic ${args.join(" ")}`);
	const res = await safeSpawn({
		command: "restic",
		args,
		env,
		signal: options?.signal,
		onStdout: (data) => {
			logData(data);
			if (options?.onProgress) {
				streamProgress(data);
			}
		},
	});

	if (includeFile) await fs.unlink(includeFile).catch(() => {});
	if (excludeFile) await fs.unlink(excludeFile).catch(() => {});
	await cleanupTemporaryKeys(env);

	if (options?.signal?.aborted) {
		logger.warn("Restic backup was aborted by signal.");
		return { result: null, exitCode: res.exitCode };
	}

	if (res.exitCode === 3) {
		logger.error(`Restic backup encountered read errors: ${res.error}`);
	}

	if (res.exitCode !== 0 && res.exitCode !== 3) {
		logger.error(`Restic backup failed: ${res.error}`);
		logger.error(`Command executed: restic ${args.join(" ")}`);

		throw new ResticError(res.exitCode, res.error);
	}

	const lastLine = res.summary.trim();
	let summaryLine = "";
	try {
		const resSummary = JSON.parse(lastLine ?? "{}");
		summaryLine = resSummary;
	} catch (_) {
		logger.warn("Failed to parse restic backup output JSON summary.", lastLine);
		summaryLine = "{}";
	}

	logger.debug(`Restic backup output last line: ${summaryLine}`);
	const result = backupOutputSchema(summaryLine);

	if (result instanceof type.errors) {
		logger.error(`Restic backup output validation failed: ${result.summary}`);
		return { result: null, exitCode: res.exitCode };
	}

	return { result, exitCode: res.exitCode };
};

const restoreOutputSchema = type({
	message_type: "'summary'",
	total_files: "number?",
	files_restored: "number",
	files_skipped: "number",
	total_bytes: "number?",
	bytes_restored: "number?",
	bytes_skipped: "number",
});

const restore = async (
	config: RepositoryConfig,
	snapshotId: string,
	target: string,
	options: {
		organizationId: string;
		include?: string[];
		exclude?: string[];
		excludeXattr?: string[];
		delete?: boolean;
		overwrite?: OverwriteMode;
	},
) => {
	const repoUrl = buildRepoUrl(config);
	const env = await buildEnv(config, options.organizationId);

	const args: string[] = ["--repo", repoUrl, "restore", snapshotId, "--target", target];

	if (options?.overwrite) {
		args.push("--overwrite", options.overwrite);
	}

	if (options?.delete) {
		args.push("--delete");
	}

	if (options?.include?.length) {
		for (const pattern of options.include) {
			args.push("--include", pattern);
		}
	}

	if (options?.exclude && options.exclude.length > 0) {
		for (const pattern of options.exclude) {
			args.push("--exclude", pattern);
		}
	}

	if (options?.excludeXattr && options.excludeXattr.length > 0) {
		for (const xattr of options.excludeXattr) {
			args.push("--exclude-xattr", xattr);
		}
	}

	addCommonArgs(args, env, config);

	logger.debug(`Executing: restic ${args.join(" ")}`);
	const res = await safeSpawn({ command: "restic", args, env });

	await cleanupTemporaryKeys(env);

	if (res.exitCode !== 0) {
		logger.error(`Restic restore failed: ${res.error}`);
		throw new ResticError(res.exitCode, res.error);
	}

	const lastLine = res.summary.trim();
	let summaryLine = "";
	try {
		const resSummary = JSON.parse(lastLine ?? "{}");
		summaryLine = resSummary;
	} catch (_) {
		logger.warn("Failed to parse restic backup output JSON summary.", lastLine);
		summaryLine = "{}";
	}

	logger.debug(`Restic restore output last line: ${summaryLine}`);
	const result = restoreOutputSchema(summaryLine);

	if (result instanceof type.errors) {
		logger.warn(`Restic restore output validation failed: ${result.summary}`);
		logger.info(`Restic restore completed for snapshot ${snapshotId} to target ${target}`);
		return {
			message_type: "summary" as const,
			total_files: 0,
			files_restored: 0,
			files_skipped: 0,
			bytes_skipped: 0,
		};
	}

	logger.info(
		`Restic restore completed for snapshot ${snapshotId} to target ${target}: ${result.files_restored} restored, ${result.files_skipped} skipped`,
	);

	return result;
};

const snapshots = async (config: RepositoryConfig, options: { tags?: string[]; organizationId: string }) => {
	const { tags, organizationId } = options;

	const repoUrl = buildRepoUrl(config);
	const env = await buildEnv(config, organizationId);

	const args = ["--repo", repoUrl, "snapshots"];

	if (tags && tags.length > 0) {
		for (const tag of tags) {
			args.push("--tag", tag);
		}
	}

	addCommonArgs(args, env, config);

	const res = await exec({ command: "restic", args, env });
	await cleanupTemporaryKeys(env);

	if (res.exitCode !== 0) {
		logger.error(`Restic snapshots retrieval failed: ${res.stderr}`);
		throw new Error(`Restic snapshots retrieval failed: ${res.stderr}`);
	}

	const result = snapshotInfoSchema.array()(JSON.parse(res.stdout));

	if (result instanceof type.errors) {
		logger.error(`Restic snapshots output validation failed: ${result.summary}`);
		throw new Error(`Restic snapshots output validation failed: ${result.summary}`);
	}

	return result;
};

const forget = async (
	config: RepositoryConfig,
	options: RetentionPolicy,
	extra: { tag: string; organizationId: string },
) => {
	const repoUrl = buildRepoUrl(config);
	const env = await buildEnv(config, extra.organizationId);

	const args: string[] = ["--repo", repoUrl, "forget", "--group-by", "tags", "--tag", extra.tag];

	if (options.keepLast) {
		args.push("--keep-last", String(options.keepLast));
	}
	if (options.keepHourly) {
		args.push("--keep-hourly", String(options.keepHourly));
	}
	if (options.keepDaily) {
		args.push("--keep-daily", String(options.keepDaily));
	}
	if (options.keepWeekly) {
		args.push("--keep-weekly", String(options.keepWeekly));
	}
	if (options.keepMonthly) {
		args.push("--keep-monthly", String(options.keepMonthly));
	}
	if (options.keepYearly) {
		args.push("--keep-yearly", String(options.keepYearly));
	}
	if (options.keepWithinDuration) {
		args.push("--keep-within-duration", options.keepWithinDuration);
	}

	args.push("--prune");
	addCommonArgs(args, env, config);

	const res = await exec({ command: "restic", args, env });
	await cleanupTemporaryKeys(env);

	if (res.exitCode !== 0) {
		logger.error(`Restic forget failed: ${res.stderr}`);
		throw new ResticError(res.exitCode, res.stderr);
	}

	return { success: true };
};

const deleteSnapshots = async (config: RepositoryConfig, snapshotIds: string[], organizationId: string) => {
	const repoUrl = buildRepoUrl(config);
	const env = await buildEnv(config, organizationId);

	if (snapshotIds.length === 0) {
		throw new Error("No snapshot IDs provided for deletion.");
	}

	const args: string[] = ["--repo", repoUrl, "forget", ...snapshotIds, "--prune"];
	addCommonArgs(args, env, config);

	const res = await exec({ command: "restic", args, env });
	await cleanupTemporaryKeys(env);

	if (res.exitCode !== 0) {
		logger.error(`Restic snapshot deletion failed: ${res.stderr}`);
		throw new ResticError(res.exitCode, res.stderr);
	}

	return { success: true };
};

const deleteSnapshot = async (config: RepositoryConfig, snapshotId: string, organizationId: string) => {
	return deleteSnapshots(config, [snapshotId], organizationId);
};

const tagSnapshots = async (
	config: RepositoryConfig,
	snapshotIds: string[],
	tags: { add?: string[]; remove?: string[]; set?: string[] },
	organizationId: string,
) => {
	const repoUrl = buildRepoUrl(config);
	const env = await buildEnv(config, organizationId);

	if (snapshotIds.length === 0) {
		throw new Error("No snapshot IDs provided for tagging.");
	}

	const args: string[] = ["--repo", repoUrl, "tag", ...snapshotIds];

	if (tags.add) {
		for (const tag of tags.add) {
			args.push("--add", tag);
		}
	}

	if (tags.remove) {
		for (const tag of tags.remove) {
			args.push("--remove", tag);
		}
	}

	if (tags.set) {
		for (const tag of tags.set) {
			args.push("--set", tag);
		}
	}

	addCommonArgs(args, env, config);

	const res = await exec({ command: "restic", args, env });
	await cleanupTemporaryKeys(env);

	if (res.exitCode !== 0) {
		logger.error(`Restic snapshot tagging failed: ${res.stderr}`);
		throw new ResticError(res.exitCode, res.stderr);
	}

	return { success: true };
};

const lsNodeSchema = type({
	name: "string",
	type: "string",
	path: "string",
	uid: "number?",
	gid: "number?",
	size: "number?",
	mode: "number?",
	mtime: "string?",
	atime: "string?",
	ctime: "string?",
	struct_type: "'node'",
});

const lsSnapshotInfoSchema = type({
	time: "string",
	parent: "string?",
	tree: "string",
	paths: "string[]",
	hostname: "string",
	username: "string?",
	id: "string",
	short_id: "string",
	struct_type: "'snapshot'",
	message_type: "'snapshot'",
});

const ls = async (
	config: RepositoryConfig,
	snapshotId: string,
	organizationId: string,
	path?: string,
	options?: { offset?: number; limit?: number },
) => {
	const repoUrl = buildRepoUrl(config);
	const env = await buildEnv(config, organizationId);

	const args: string[] = ["--repo", repoUrl, "ls", snapshotId, "--long"];

	if (path) {
		args.push(path);
	}

	addCommonArgs(args, env, config);

	let snapshot: typeof lsSnapshotInfoSchema.infer | null = null;
	const nodes: Array<typeof lsNodeSchema.infer> = [];
	let totalNodes = 0;
	let isFirstLine = true;
	let hasMore = false;

	const offset = Math.max(options?.offset ?? 0, 0);
	const limit = Math.min(Math.max(options?.limit ?? 500, 1), 500);

	const res = await safeSpawn({
		command: "restic",
		args,
		env,
		onStdout: (line) => {
			const trimmedLine = line.trim();
			if (!trimmedLine) return;

			try {
				const data = JSON.parse(trimmedLine);

				if (isFirstLine) {
					isFirstLine = false;
					const snapshotValidation = lsSnapshotInfoSchema(data);
					if (!(snapshotValidation instanceof type.errors)) {
						snapshot = snapshotValidation;
					}
					return;
				}

				const nodeValidation = lsNodeSchema(data);
				if (nodeValidation instanceof type.errors) {
					logger.warn(`Skipping invalid node: ${nodeValidation.summary}`);
					return;
				}

				if (totalNodes >= offset && totalNodes < offset + limit) {
					nodes.push(nodeValidation);
				}
				totalNodes++;

				if (totalNodes >= offset + limit + 1) {
					hasMore = true;
				}
			} catch (_) {
				// Ignore JSON parse errors for non-JSON lines
			}
		},
	});

	await cleanupTemporaryKeys(env);

	if (res.exitCode !== 0) {
		logger.error(`Restic ls failed: ${res.error}`);
		throw new ResticError(res.exitCode, res.error);
	}

	if (totalNodes > offset + limit) {
		hasMore = true;
	}

	return {
		snapshot: snapshot as typeof lsSnapshotInfoSchema.infer | null,
		nodes,
		pagination: {
			offset,
			limit,
			total: totalNodes,
			hasMore,
		},
	};
};

const unlock = async (config: RepositoryConfig, options: { signal?: AbortSignal; organizationId: string }) => {
	const repoUrl = buildRepoUrl(config);
	const env = await buildEnv(config, options.organizationId);

	const args = ["unlock", "--repo", repoUrl, "--remove-all"];
	addCommonArgs(args, env, config);

	const res = await exec({ command: "restic", args, env, signal: options?.signal });
	await cleanupTemporaryKeys(env);

	if (options?.signal?.aborted) {
		logger.warn("Restic unlock was aborted by signal.");
		return { success: false, message: "Operation aborted" };
	}

	if (res.exitCode !== 0) {
		logger.error(`Restic unlock failed: ${res.stderr}`);
		throw new ResticError(res.exitCode, res.stderr);
	}

	logger.info(`Restic unlock succeeded for repository: ${repoUrl}`);
	return { success: true, message: "Repository unlocked successfully" };
};

const check = async (
	config: RepositoryConfig,
	options: { readData?: boolean; signal?: AbortSignal; organizationId: string },
) => {
	const repoUrl = buildRepoUrl(config);
	const env = await buildEnv(config, options.organizationId);

	const args: string[] = ["--repo", repoUrl, "check"];

	if (options?.readData) {
		args.push("--read-data");
	}

	addCommonArgs(args, env, config);

	const res = await exec({ command: "restic", args, env, signal: options?.signal });
	await cleanupTemporaryKeys(env);

	if (options?.signal?.aborted) {
		logger.warn("Restic check was aborted by signal.");
		return { success: false, hasErrors: true, output: "", error: "Operation aborted" };
	}

	const { stdout, stderr } = res;

	if (res.exitCode !== 0) {
		logger.error(`Restic check failed: ${stderr}`);
		return {
			success: false,
			hasErrors: true,
			output: stdout,
			error: stderr,
		};
	}

	const hasErrors = stdout.includes("Fatal");

	logger.info(`Restic check completed for repository: ${repoUrl}`);
	return {
		success: !hasErrors,
		hasErrors,
		output: stdout,
		error: hasErrors ? "Repository contains errors" : null,
	};
};

const repairIndex = async (config: RepositoryConfig, options: { signal?: AbortSignal; organizationId: string }) => {
	const repoUrl = buildRepoUrl(config);
	const env = await buildEnv(config, options.organizationId);

	const args = ["repair", "index", "--repo", repoUrl];
	addCommonArgs(args, env, config);

	const res = await exec({ command: "restic", args, env, signal: options?.signal });
	await cleanupTemporaryKeys(env);

	if (options?.signal?.aborted) {
		logger.warn("Restic repair index was aborted by signal.");
		return { success: false, message: "Operation aborted", output: "" };
	}

	const { stdout, stderr } = res;

	if (res.exitCode !== 0) {
		logger.error(`Restic repair index failed: ${stderr}`);
		throw new ResticError(res.exitCode, stderr);
	}

	logger.info(`Restic repair index completed for repository: ${repoUrl}`);
	return {
		success: true,
		output: stdout,
		message: "Index repaired successfully",
	};
};

const copy = async (
	sourceConfig: RepositoryConfig,
	destConfig: RepositoryConfig,
	options: { organizationId: string; tag?: string; snapshotId?: string },
) => {
	const sourceRepoUrl = buildRepoUrl(sourceConfig);
	const destRepoUrl = buildRepoUrl(destConfig);

	const sourceEnv = await buildEnv(sourceConfig, options.organizationId);
	const destEnv = await buildEnv(destConfig, options.organizationId);

	const env: Record<string, string> = {
		...sourceEnv,
		...destEnv,
		RESTIC_FROM_PASSWORD_FILE: sourceEnv.RESTIC_PASSWORD_FILE,
	};

	const args: string[] = ["--repo", destRepoUrl, "copy", "--from-repo", sourceRepoUrl];

	if (options.tag) {
		args.push("--tag", options.tag);
	}

	if (options.snapshotId) {
		args.push(options.snapshotId);
	} else {
		args.push("latest");
	}

	addCommonArgs(args, env, destConfig, { skipBandwidth: true });

	const sourceDownloadLimit = formatBandwidthLimit(sourceConfig.downloadLimit);
	const destUploadLimit = formatBandwidthLimit(destConfig.uploadLimit);

	if (sourceDownloadLimit) {
		args.push("--limit-download", sourceDownloadLimit);
	}

	// Apply upload limit to destination for all backends
	if (destUploadLimit) {
		args.push("--limit-upload", destUploadLimit);
	}

	logger.info(`Copying snapshots from ${sourceRepoUrl} to ${destRepoUrl}...`);
	logger.debug(`Executing: restic ${args.join(" ")}`);

	const res = await exec({ command: "restic", args, env });

	await cleanupTemporaryKeys(sourceEnv);
	await cleanupTemporaryKeys(destEnv);

	const { stdout, stderr } = res;

	if (res.exitCode !== 0) {
		logger.error(`Restic copy failed: ${stderr}`);
		throw new ResticError(res.exitCode, stderr);
	}

	logger.info(`Restic copy completed from ${sourceRepoUrl} to ${destRepoUrl}`);
	return {
		success: true,
		output: stdout,
	};
};

const formatBandwidthLimit = (limit?: BandwidthLimit): string => {
	if (!limit || !limit.enabled || limit.value <= 0) {
		return "";
	}

	let kibibytesPerSecond: number;
	switch (limit.unit) {
		case "Kbps":
			// Kilobits per second to KiB/s: kilobits→bits→bytes→KiB
			kibibytesPerSecond = (limit.value * 1000) / 8 / 1024;
			break;
		case "Mbps":
			// Megabits per second to KiB/s: multiply by 1000000 (Mb to bits), divide by 8 (bits to bytes), then by 1024 (bytes to KiB)
			kibibytesPerSecond = (limit.value * 1000000) / (8 * 1024);
			break;
		case "Gbps":
			// Gigabits per second to KiB/s: multiply by 1000000000 (Gb to bits), divide by 8 (bits to bytes), then by 1024 (bytes to KiB)
			kibibytesPerSecond = (limit.value * 1000000000) / (8 * 1024);
			break;
		default:
			return "";
	}

	const limitValue = Math.max(1, Math.floor(kibibytesPerSecond));
	return `${limitValue}`;
};

export const addCommonArgs = (
	args: string[],
	env: Record<string, string>,
	config?: RepositoryConfig,
	options?: { skipBandwidth?: boolean },
) => {
	args.push("--json");

	if (env._SFTP_SSH_ARGS) {
		args.push("-o", `sftp.args=${env._SFTP_SSH_ARGS}`);
	}

	if (env.AWS_S3_BUCKET_LOOKUP === "dns") {
		args.push("-o", "s3.bucket-lookup=dns");
	}

	if (env._INSECURE_TLS === "true") {
		args.push("--insecure-tls");
	}

	if (env.RESTIC_CACERT) {
		args.push("--cacert", env.RESTIC_CACERT);
	}

	if (config && !options?.skipBandwidth) {
		const uploadLimit = formatBandwidthLimit(config.uploadLimit);
		if (uploadLimit) {
			args.push("--limit-upload", uploadLimit);
		}

		const downloadLimit = formatBandwidthLimit(config.downloadLimit);
		if (downloadLimit) {
			args.push("--limit-download", downloadLimit);
		}
	}
};

export const restic = {
	init,
	backup,
	restore,
	snapshots,
	forget,
	deleteSnapshot,
	deleteSnapshots,
	tagSnapshots,
	unlock,
	ls,
	check,
	repairIndex,
	copy,
};

export const cleanupTemporaryKeys = async (env: Record<string, string>) => {
	const keysToClean = ["_SFTP_KEY_PATH", "_SFTP_KNOWN_HOSTS_PATH", "RESTIC_CACERT", "GOOGLE_APPLICATION_CREDENTIALS"];

	for (const key of keysToClean) {
		if (env[key]) {
			await fs.unlink(env[key]).catch(() => {});
		}
	}

	// Clean up custom password files
	if (env.RESTIC_PASSWORD_FILE && env.RESTIC_PASSWORD_FILE !== RESTIC_PASS_FILE) {
		await fs.unlink(env.RESTIC_PASSWORD_FILE).catch(() => {});
	}
};
