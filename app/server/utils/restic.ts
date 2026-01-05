import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { throttle } from "es-toolkit";
import { type } from "arktype";
import { REPOSITORY_BASE, RESTIC_PASS_FILE, DEFAULT_EXCLUDES } from "../core/constants";
import { config as appConfig } from "../core/config";
import { logger } from "./logger";
import { cryptoUtils } from "./crypto";
import type { RetentionPolicy } from "../modules/backups/backups.dto";
import { safeSpawn } from "./spawn";
import type { CompressionMode, RepositoryConfig, OverwriteMode } from "~/schemas/restic";
import { ResticError } from "./errors";

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

const ensurePassfile = async () => {
	await fs.mkdir(path.dirname(RESTIC_PASS_FILE), { recursive: true });

	try {
		await fs.access(RESTIC_PASS_FILE);
	} catch {
		logger.info("Restic passfile not found, creating a new one...");
		await fs.writeFile(RESTIC_PASS_FILE, crypto.randomBytes(32).toString("hex"), { mode: 0o600 });
	}
};

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

export const buildEnv = async (config: RepositoryConfig) => {
	const env: Record<string, string> = {
		RESTIC_CACHE_DIR: "/var/lib/zerobyte/restic/cache",
		PATH: process.env.PATH || "/usr/local/bin:/usr/bin:/bin",
	};

	if (config.isExistingRepository && config.customPassword) {
		const passwordFilePath = path.join("/tmp", `zerobyte-pass-${crypto.randomBytes(8).toString("hex")}.txt`);

		await fs.writeFile(passwordFilePath, config.customPassword, { mode: 0o600 });
		env.RESTIC_PASSWORD_FILE = passwordFilePath;
	} else {
		env.RESTIC_PASSWORD_FILE = RESTIC_PASS_FILE;
	}

	switch (config.backend) {
		case "s3":
			env.AWS_ACCESS_KEY_ID = config.accessKeyId;
			env.AWS_SECRET_ACCESS_KEY = config.secretAccessKey;
			break;
		case "r2":
			env.AWS_ACCESS_KEY_ID = config.accessKeyId;
			env.AWS_SECRET_ACCESS_KEY = config.secretAccessKey;
			env.AWS_REGION = "auto";
			env.AWS_S3_FORCE_PATH_STYLE = "true";
			break;
		case "gcs": {
			const credentialsPath = path.join("/tmp", `zerobyte-gcs-${crypto.randomBytes(8).toString("hex")}.json`);
			await fs.writeFile(credentialsPath, config.credentialsJson, { mode: 0o600 });
			env.GOOGLE_PROJECT_ID = config.projectId;
			env.GOOGLE_APPLICATION_CREDENTIALS = credentialsPath;
			break;
		}
		case "azure": {
			env.AZURE_ACCOUNT_NAME = config.accountName;
			env.AZURE_ACCOUNT_KEY = config.accountKey;
			if (config.endpointSuffix) {
				env.AZURE_ENDPOINT_SUFFIX = config.endpointSuffix;
			}
			break;
		}
		case "rest": {
			if (config.username) {
				env.RESTIC_REST_USERNAME = config.username;
			}
			if (config.password) {
				env.RESTIC_REST_PASSWORD = config.password;
			}
			break;
		}
		case "sftp": {
			const keyPath = path.join("/tmp", `zerobyte-ssh-${crypto.randomBytes(8).toString("hex")}`);

			let normalizedKey = config.privateKey.replace(/\r\n/g, "\n");
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
				"LogLevel=VERBOSE",
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
		const certPath = path.join("/tmp", `zerobyte-cacert-${crypto.randomBytes(8).toString("hex")}.pem`);
		await fs.writeFile(certPath, config.cacert, { mode: 0o600 });
		env.RESTIC_CACERT = certPath;
	}

	if (config.insecureTls) {
		env._INSECURE_TLS = "true";
	}

	return env;
};

/**
 * Resolves all secret placeholders in config and builds repo URL + env.
 * Call this at the start of each restic operation.
 */
const resolveAndBuild = async (config: RepositoryConfig) => {
	const resolved = await cryptoUtils.resolveSecretsDeep(config);
	const repoUrl = buildRepoUrl(resolved);
	const env = await buildEnv(resolved);
	return { resolved, repoUrl, env };
};

const init = async (config: RepositoryConfig) => {
	await ensurePassfile();

	const { repoUrl, env } = await resolveAndBuild(config);

	logger.info(`Initializing restic repository at ${repoUrl}...`);

	const args = ["init", "--repo", repoUrl];
	addCommonArgs(args, env);

	const res = await safeSpawn({ command: "restic", args, env });
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
	options?: {
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
	const { repoUrl, env } = await resolveAndBuild(config);

	const args: string[] = ["--repo", repoUrl, "backup", "--compression", options?.compressionMode ?? "auto"];

	if (options?.oneFileSystem) {
		args.push("--one-file-system");
	}

	if (appConfig.resticHostname) {
		args.push("--host", appConfig.resticHostname);
	}

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

	addCommonArgs(args, env);

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

	let stdout = "";

	logger.debug(`Executing: restic ${args.join(" ")}`);
	const res = await safeSpawn({
		command: "restic",
		args,
		env,
		signal: options?.signal,
		onStdout: (data) => {
			stdout = data;
			logData(data);

			if (options?.onProgress) {
				streamProgress(data);
			}
		},
		finally: async () => {
			includeFile && (await fs.unlink(includeFile).catch(() => {}));
			excludeFile && (await fs.unlink(excludeFile).catch(() => {}));
			await cleanupTemporaryKeys(env);
		},
	});

	if (options?.signal?.aborted) {
		logger.warn("Restic backup was aborted by signal.");
		return { result: null, exitCode: res.exitCode };
	}

	if (res.exitCode === 3) {
		logger.error(`Restic backup encountered read errors: ${res.stderr}`);
	}

	if (res.exitCode !== 0 && res.exitCode !== 3) {
		logger.error(`Restic backup failed: ${res.stderr}`);
		logger.error(`Command executed: restic ${args.join(" ")}`);

		throw new ResticError(res.exitCode, res.stderr);
	}

	const lastLine = (stdout || res.stdout).trim();
	let summaryLine = "";
	try {
		const resSummary = JSON.parse(lastLine ?? "{}");
		summaryLine = resSummary;
	} catch (_) {
		logger.warn("Failed to parse restic backup output JSON summary.", lastLine);
		summaryLine = "{}";
	}

	const result = backupOutputSchema(summaryLine);

	if (result instanceof type.errors) {
		logger.error(`Restic backup output validation failed: ${result}`);
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
	options?: {
		include?: string[];
		exclude?: string[];
		excludeXattr?: string[];
		delete?: boolean;
		overwrite?: OverwriteMode;
	},
) => {
	const { repoUrl, env } = await resolveAndBuild(config);

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

	addCommonArgs(args, env);

	logger.debug(`Executing: restic ${args.join(" ")}`);
	const res = await safeSpawn({ command: "restic", args, env });

	await cleanupTemporaryKeys(env);

	if (res.exitCode !== 0) {
		logger.error(`Restic restore failed: ${res.stderr}`);
		throw new ResticError(res.exitCode, res.stderr);
	}

	const outputLines = res.stdout.trim().split("\n");
	const lastLine = outputLines[outputLines.length - 1];

	if (!lastLine) {
		logger.info(`Restic restore completed for snapshot ${snapshotId} to target ${target}`);
		return {
			message_type: "summary" as const,
			total_files: 0,
			files_restored: 0,
			files_skipped: 0,
			bytes_skipped: 0,
		};
	}

	logger.debug(`Restic restore output last line: ${lastLine}`);
	const resSummary = JSON.parse(lastLine);
	const result = restoreOutputSchema(resSummary);

	if (result instanceof type.errors) {
		logger.warn(`Restic restore output validation failed: ${result}`);
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

const snapshots = async (config: RepositoryConfig, options: { tags?: string[] } = {}) => {
	const { tags } = options;

	const { repoUrl, env } = await resolveAndBuild(config);

	const args = ["--repo", repoUrl, "snapshots"];

	if (tags && tags.length > 0) {
		for (const tag of tags) {
			args.push("--tag", tag);
		}
	}

	addCommonArgs(args, env);

	const res = await safeSpawn({ command: "restic", args, env });
	await cleanupTemporaryKeys(env);

	if (res.exitCode !== 0) {
		logger.error(`Restic snapshots retrieval failed: ${res.stderr}`);
		throw new Error(`Restic snapshots retrieval failed: ${res.stderr}`);
	}

	const result = snapshotInfoSchema.array()(JSON.parse(res.stdout));

	if (result instanceof type.errors) {
		logger.error(`Restic snapshots output validation failed: ${result}`);
		throw new Error(`Restic snapshots output validation failed: ${result}`);
	}

	return result;
};

const forget = async (config: RepositoryConfig, options: RetentionPolicy, extra: { tag: string }) => {
	const { repoUrl, env } = await resolveAndBuild(config);

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
	addCommonArgs(args, env);

	const res = await safeSpawn({ command: "restic", args, env });
	await cleanupTemporaryKeys(env);

	if (res.exitCode !== 0) {
		logger.error(`Restic forget failed: ${res.stderr}`);
		throw new ResticError(res.exitCode, res.stderr);
	}

	return { success: true };
};

const deleteSnapshots = async (config: RepositoryConfig, snapshotIds: string[]) => {
	const { repoUrl, env } = await resolveAndBuild(config);

	if (snapshotIds.length === 0) {
		throw new Error("No snapshot IDs provided for deletion.");
	}

	const args: string[] = ["--repo", repoUrl, "forget", ...snapshotIds, "--prune"];
	addCommonArgs(args, env);

	const res = await safeSpawn({ command: "restic", args, env });
	await cleanupTemporaryKeys(env);

	if (res.exitCode !== 0) {
		logger.error(`Restic snapshot deletion failed: ${res.stderr}`);
		throw new ResticError(res.exitCode, res.stderr);
	}

	return { success: true };
};

const deleteSnapshot = async (config: RepositoryConfig, snapshotId: string) => {
	return deleteSnapshots(config, [snapshotId]);
};

const tagSnapshots = async (
	config: RepositoryConfig,
	snapshotIds: string[],
	tags: { add?: string[]; remove?: string[]; set?: string[] },
) => {
	const { repoUrl, env } = await resolveAndBuild(config);

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

	addCommonArgs(args, env);

	const res = await safeSpawn({ command: "restic", args, env });
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

const ls = async (config: RepositoryConfig, snapshotId: string, path?: string) => {
	const { repoUrl, env } = await resolveAndBuild(config);

	const args: string[] = ["--repo", repoUrl, "ls", snapshotId, "--long"];

	if (path) {
		args.push(path);
	}

	addCommonArgs(args, env);

	const res = await safeSpawn({ command: "restic", args, env });
	await cleanupTemporaryKeys(env);

	if (res.exitCode !== 0) {
		logger.error(`Restic ls failed: ${res.stderr}`);
		throw new ResticError(res.exitCode, res.stderr);
	}

	// The output is a stream of JSON objects, first is snapshot info, rest are file/dir nodes
	const stdout = res.stdout;
	const lines = stdout
		.trim()
		.split("\n")
		.filter((line) => line.trim());

	if (lines.length === 0) {
		return { snapshot: null, nodes: [] };
	}

	// First line is snapshot info
	const snapshotLine = JSON.parse(lines[0] ?? "{}");
	const snapshot = lsSnapshotInfoSchema(snapshotLine);

	if (snapshot instanceof type.errors) {
		logger.error(`Restic ls snapshot info validation failed: ${snapshot}`);
		throw new Error(`Restic ls snapshot info validation failed: ${snapshot}`);
	}

	const nodes: Array<typeof lsNodeSchema.infer> = [];
	for (let i = 1; i < lines.length; i++) {
		const nodeLine = JSON.parse(lines[i] ?? "{}");
		const nodeValidation = lsNodeSchema(nodeLine);

		if (nodeValidation instanceof type.errors) {
			logger.warn(`Skipping invalid node: ${nodeValidation}`);
			continue;
		}

		nodes.push(nodeValidation);
	}

	return { snapshot, nodes };
};

const unlock = async (config: RepositoryConfig) => {
	const { repoUrl, env } = await resolveAndBuild(config);

	const args = ["unlock", "--repo", repoUrl, "--remove-all"];
	addCommonArgs(args, env);

	const res = await safeSpawn({ command: "restic", args, env });
	await cleanupTemporaryKeys(env);

	if (res.exitCode !== 0) {
		logger.error(`Restic unlock failed: ${res.stderr}`);
		throw new ResticError(res.exitCode, res.stderr);
	}

	logger.info(`Restic unlock succeeded for repository: ${repoUrl}`);
	return { success: true, message: "Repository unlocked successfully" };
};

const check = async (config: RepositoryConfig, options?: { readData?: boolean }) => {
	const { repoUrl, env } = await resolveAndBuild(config);

	const args: string[] = ["--repo", repoUrl, "check"];

	if (options?.readData) {
		args.push("--read-data");
	}

	addCommonArgs(args, env);

	const res = await safeSpawn({ command: "restic", args, env });
	await cleanupTemporaryKeys(env);

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

const repairIndex = async (config: RepositoryConfig) => {
	const { repoUrl, env } = await resolveAndBuild(config);

	const args = ["repair", "index", "--repo", repoUrl];
	addCommonArgs(args, env);

	const res = await safeSpawn({ command: "restic", args, env });
	await cleanupTemporaryKeys(env);

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
	options: {
		tag?: string;
		snapshotId?: string;
	},
) => {
	const { resolved: resolvedSource, repoUrl: sourceRepoUrl, env: sourceEnv } = await resolveAndBuild(sourceConfig);
	const { repoUrl: destRepoUrl, env: destEnv } = await resolveAndBuild(destConfig);

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

	addCommonArgs(args, env);

	if (resolvedSource.backend === "sftp" && sourceEnv._SFTP_SSH_ARGS) {
		args.push("-o", `sftp.args=${sourceEnv._SFTP_SSH_ARGS}`);
	}

	logger.info(`Copying snapshots from ${sourceRepoUrl} to ${destRepoUrl}...`);
	logger.debug(`Executing: restic ${args.join(" ")}`);

	const res = await safeSpawn({ command: "restic", args, env });

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

export const cleanupTemporaryKeys = async (env: Record<string, string>) => {
	if (env._SFTP_KEY_PATH) {
		await fs.unlink(env._SFTP_KEY_PATH).catch(() => {});
	}

	if (env._SFTP_KNOWN_HOSTS_PATH) {
		await fs.unlink(env._SFTP_KNOWN_HOSTS_PATH).catch(() => {});
	}

	if (env.RESTIC_PASSWORD_FILE && env.RESTIC_PASSWORD_FILE !== RESTIC_PASS_FILE) {
		await fs.unlink(env.RESTIC_PASSWORD_FILE).catch(() => {});
	}

	if (env.GOOGLE_APPLICATION_CREDENTIALS) {
		await fs.unlink(env.GOOGLE_APPLICATION_CREDENTIALS).catch(() => {});
	}

	if (env.RESTIC_CACERT) {
		await fs.unlink(env.RESTIC_CACERT).catch(() => {});
	}
};

export const addCommonArgs = (args: string[], env: Record<string, string>) => {
	args.push("--json");

	if (env._SFTP_SSH_ARGS) {
		args.push("-o", `sftp.args=${env._SFTP_SSH_ARGS}`);
	}

	if (env._INSECURE_TLS === "true") {
		args.push("--insecure-tls");
	}

	if (env.RESTIC_CACERT) {
		args.push("--cacert", env.RESTIC_CACERT);
	}
};

export const restic = {
	ensurePassfile,
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
