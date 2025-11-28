import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { throttle } from "es-toolkit";
import { type } from "arktype";
import { $ } from "bun";
import { REPOSITORY_BASE, RESTIC_PASS_FILE } from "../core/constants";
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
	username: "string",
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

const buildRepoUrl = (config: RepositoryConfig): string => {
	switch (config.backend) {
		case "local":
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

const buildEnv = async (config: RepositoryConfig) => {
	const env: Record<string, string> = {
		RESTIC_CACHE_DIR: "/var/lib/zerobyte/restic/cache",
		PATH: process.env.PATH || "/usr/local/bin:/usr/bin:/bin",
	};

	if (config.isExistingRepository && config.customPassword) {
		const decryptedPassword = await cryptoUtils.decrypt(config.customPassword);
		const passwordFilePath = path.join("/tmp", `zerobyte-pass-${crypto.randomBytes(8).toString("hex")}.txt`);

		await fs.writeFile(passwordFilePath, decryptedPassword, { mode: 0o600 });
		env.RESTIC_PASSWORD_FILE = passwordFilePath;
	} else {
		env.RESTIC_PASSWORD_FILE = RESTIC_PASS_FILE;
	}

	switch (config.backend) {
		case "s3":
			env.AWS_ACCESS_KEY_ID = await cryptoUtils.decrypt(config.accessKeyId);
			env.AWS_SECRET_ACCESS_KEY = await cryptoUtils.decrypt(config.secretAccessKey);
			break;
		case "r2":
			env.AWS_ACCESS_KEY_ID = await cryptoUtils.decrypt(config.accessKeyId);
			env.AWS_SECRET_ACCESS_KEY = await cryptoUtils.decrypt(config.secretAccessKey);
			env.AWS_REGION = "auto";
			env.AWS_S3_FORCE_PATH_STYLE = "true";
			break;
		case "gcs": {
			const decryptedCredentials = await cryptoUtils.decrypt(config.credentialsJson);
			const credentialsPath = path.join("/tmp", `zerobyte-gcs-${crypto.randomBytes(8).toString("hex")}.json`);
			await fs.writeFile(credentialsPath, decryptedCredentials, { mode: 0o600 });
			env.GOOGLE_PROJECT_ID = config.projectId;
			env.GOOGLE_APPLICATION_CREDENTIALS = credentialsPath;
			break;
		}
		case "azure": {
			env.AZURE_ACCOUNT_NAME = config.accountName;
			env.AZURE_ACCOUNT_KEY = await cryptoUtils.decrypt(config.accountKey);
			if (config.endpointSuffix) {
				env.AZURE_ENDPOINT_SUFFIX = config.endpointSuffix;
			}
			break;
		}
		case "rest": {
			if (config.username) {
				env.RESTIC_REST_USERNAME = await cryptoUtils.decrypt(config.username);
			}
			if (config.password) {
				env.RESTIC_REST_PASSWORD = await cryptoUtils.decrypt(config.password);
			}
			break;
		}
		case "sftp": {
			const decryptedKey = await cryptoUtils.decrypt(config.privateKey);
			const keyPath = path.join("/tmp", `ironmount-ssh-${crypto.randomBytes(8).toString("hex")}`);

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
				"StrictHostKeyChecking=no",
				"-o",
				"UserKnownHostsFile=/dev/null",
				"-o",
				"LogLevel=VERBOSE",
				"-i",
				keyPath,
			];

			if (config.port && config.port !== 22) {
				sshArgs.push("-p", String(config.port));
			}

			env._SFTP_SSH_ARGS = sshArgs.join(" ");
			logger.info(`SFTP: SSH args: ${env._SFTP_SSH_ARGS}`);
			break;
		}
	}

	return env;
};

const init = async (config: RepositoryConfig) => {
	await ensurePassfile();

	const repoUrl = buildRepoUrl(config);

	logger.info(`Initializing restic repository at ${repoUrl}...`);

	const env = await buildEnv(config);

	const args = ["init", "--repo", repoUrl];
	addCommonArgs(args, config, env);

	const res = await $`restic ${args}`.env(env).nothrow();
	await cleanupTemporaryKeys(config, env);

	if (res.exitCode !== 0) {
		logger.error(`Restic init failed: ${res.stderr}`);
		return { success: false, error: res.stderr.toString() };
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
		include?: string[];
		tags?: string[];
		compressionMode?: CompressionMode;
		signal?: AbortSignal;
		onProgress?: (progress: BackupProgress) => void;
	},
) => {
	const repoUrl = buildRepoUrl(config);
	const env = await buildEnv(config);

	const args: string[] = [
		"--repo",
		repoUrl,
		"backup",
		"--one-file-system",
		"--compression",
		options?.compressionMode ?? "auto",
	];

	if (options?.tags && options.tags.length > 0) {
		for (const tag of options.tags) {
			args.push("--tag", tag);
		}
	}

	let includeFile: string | null = null;
	if (options?.include && options.include.length > 0) {
		const tmp = await fs.mkdtemp("restic-include");
		includeFile = path.join(tmp, `include.txt`);
		const includePaths = options.include.map((p) => path.join(source, p));

		await fs.writeFile(includeFile, includePaths.join("\n"), "utf-8");

		args.push("--files-from", includeFile);
	} else {
		args.push(source);
	}

	if (options?.exclude && options.exclude.length > 0) {
		for (const pattern of options.exclude) {
			args.push("--exclude", pattern);
		}
	}

	addCommonArgs(args, config, env);

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
			await cleanupTemporaryKeys(config, env);
		},
	});

	if (res.exitCode === 3) {
		logger.error(`Restic backup encountered read errors: ${res.stderr.toString()}`);
	}

	if (res.exitCode !== 0 && res.exitCode !== 3) {
		logger.error(`Restic backup failed: ${res.stderr.toString()}`);
		logger.error(`Command executed: restic ${args.join(" ")}`);

		throw new ResticError(res.exitCode, res.stderr.toString());
	}

	const lastLine = stdout.trim();
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
	const repoUrl = buildRepoUrl(config);
	const env = await buildEnv(config);

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

	addCommonArgs(args, config, env);

	logger.debug(`Executing: restic ${args.join(" ")}`);
	const res = await $`restic ${args}`.env(env).nothrow();
	await cleanupTemporaryKeys(config, env);

	if (res.exitCode !== 0) {
		logger.error(`Restic restore failed: ${res.stderr}`);
		throw new ResticError(res.exitCode, res.stderr.toString());
	}

	const stdout = res.text();
	const outputLines = stdout.trim().split("\n");
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

	const repoUrl = buildRepoUrl(config);
	const env = await buildEnv(config);

	const args = ["--repo", repoUrl, "snapshots"];

	if (tags && tags.length > 0) {
		for (const tag of tags) {
			args.push("--tag", tag);
		}
	}

	addCommonArgs(args, config, env);

	const res = await $`restic ${args}`.env(env).nothrow().quiet();
	await cleanupTemporaryKeys(config, env);

	if (res.exitCode !== 0) {
		logger.error(`Restic snapshots retrieval failed: ${res.stderr}`);
		throw new Error(`Restic snapshots retrieval failed: ${res.stderr}`);
	}

	const result = snapshotInfoSchema.array()(res.json());

	if (result instanceof type.errors) {
		logger.error(`Restic snapshots output validation failed: ${result}`);
		throw new Error(`Restic snapshots output validation failed: ${result}`);
	}

	return result;
};

const forget = async (config: RepositoryConfig, options: RetentionPolicy, extra: { tag: string }) => {
	const repoUrl = buildRepoUrl(config);
	const env = await buildEnv(config);

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
	addCommonArgs(args, config, env);

	const res = await $`restic ${args}`.env(env).nothrow();
	await cleanupTemporaryKeys(config, env);

	if (res.exitCode !== 0) {
		logger.error(`Restic forget failed: ${res.stderr}`);
		throw new ResticError(res.exitCode, res.stderr.toString());
	}

	return { success: true };
};

const deleteSnapshot = async (config: RepositoryConfig, snapshotId: string) => {
	const repoUrl = buildRepoUrl(config);
	const env = await buildEnv(config);

	const args: string[] = ["--repo", repoUrl, "forget", snapshotId, "--prune"];
	addCommonArgs(args, config, env);

	const res = await $`restic ${args}`.env(env).nothrow();
	await cleanupTemporaryKeys(config, env);

	if (res.exitCode !== 0) {
		logger.error(`Restic snapshot deletion failed: ${res.stderr}`);
		throw new ResticError(res.exitCode, res.stderr.toString());
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
	const repoUrl = buildRepoUrl(config);
	const env = await buildEnv(config);

	const args: string[] = ["--repo", repoUrl, "ls", snapshotId, "--long"];

	if (path) {
		args.push(path);
	}

	addCommonArgs(args, config, env);

	const res = await safeSpawn({ command: "restic", args, env });
	await cleanupTemporaryKeys(config, env);

	if (res.exitCode !== 0) {
		logger.error(`Restic ls failed: ${res.stderr}`);
		throw new ResticError(res.exitCode, res.stderr.toString());
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
	const repoUrl = buildRepoUrl(config);
	const env = await buildEnv(config);

	const args = ["unlock", "--repo", repoUrl, "--remove-all"];
	addCommonArgs(args, config, env);

	const res = await $`restic ${args}`.env(env).nothrow();
	await cleanupTemporaryKeys(config, env);

	if (res.exitCode !== 0) {
		logger.error(`Restic unlock failed: ${res.stderr}`);
		throw new ResticError(res.exitCode, res.stderr.toString());
	}

	logger.info(`Restic unlock succeeded for repository: ${repoUrl}`);
	return { success: true, message: "Repository unlocked successfully" };
};

const check = async (config: RepositoryConfig, options?: { readData?: boolean }) => {
	const repoUrl = buildRepoUrl(config);
	const env = await buildEnv(config);

	const args: string[] = ["--repo", repoUrl, "check"];

	if (options?.readData) {
		args.push("--read-data");
	}

	addCommonArgs(args, config, env);

	const res = await $`restic ${args}`.env(env).nothrow();
	await cleanupTemporaryKeys(config, env);

	const stdout = res.text();
	const stderr = res.stderr.toString();

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
	const repoUrl = buildRepoUrl(config);
	const env = await buildEnv(config);

	const args = ["repair", "index", "--repo", repoUrl];
	addCommonArgs(args, config, env);

	const res = await $`restic ${args}`.env(env).nothrow();
	await cleanupTemporaryKeys(config, env);

	const stdout = res.text();
	const stderr = res.stderr.toString();

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
	const sourceRepoUrl = buildRepoUrl(sourceConfig);
	const destRepoUrl = buildRepoUrl(destConfig);

	const sourceEnv = await buildEnv(sourceConfig);
	const destEnv = await buildEnv(destConfig);

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

	addCommonArgs(args, destConfig, destEnv);

	if (sourceConfig.backend === "sftp" && sourceEnv._SFTP_SSH_ARGS) {
		args.push("-o", `sftp.args=${sourceEnv._SFTP_SSH_ARGS}`);
	}

	logger.info(`Copying snapshots from ${sourceRepoUrl} to ${destRepoUrl}...`);
	logger.debug(`Executing: restic ${args.join(" ")}`);

	const res = await $`restic ${args}`.env(env).nothrow();

	await cleanupTemporaryKeys(sourceConfig, sourceEnv);
	await cleanupTemporaryKeys(destConfig, destEnv);

	const stdout = res.text();
	const stderr = res.stderr.toString();

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

const cleanupTemporaryKeys = async (config: RepositoryConfig, env: Record<string, string>) => {
	if (config.backend === "sftp" && env._SFTP_KEY_PATH) {
		await fs.unlink(env._SFTP_KEY_PATH).catch(() => {});
	} else if (config.isExistingRepository && config.customPassword && env.RESTIC_PASSWORD_FILE) {
		await fs.unlink(env.RESTIC_PASSWORD_FILE).catch(() => {});
	} else if (config.backend === "gcs" && env.GOOGLE_APPLICATION_CREDENTIALS) {
		await fs.unlink(env.GOOGLE_APPLICATION_CREDENTIALS).catch(() => {});
	}
};

const addCommonArgs = (args: string[], config: RepositoryConfig, env: Record<string, string>) => {
	args.push("--retry-lock", "1m", "--json");
	if (config.backend === "sftp" && env._SFTP_SSH_ARGS) {
		args.push("-o", `sftp.args=${env._SFTP_SSH_ARGS}`);
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
	unlock,
	ls,
	check,
	repairIndex,
	copy,
};
