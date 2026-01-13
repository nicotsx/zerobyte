import { type } from "arktype";
import { throttle } from "es-toolkit";
import type { CompressionMode, OverwriteMode, RepositoryConfig } from "~/schemas/restic";
import { config as appConfig } from "../../core/config";
import { DEFAULT_EXCLUDES } from "../../core/constants";
import { ResticError } from "../errors";
import { logger } from "../logger";
import { safeSpawn } from "../spawn";
import { buildEnv, buildRepoUrl } from "./config";
import type { BackupProgress } from "./schemas";
import { backupOutputSchema, backupProgressSchema, restoreOutputSchema, snapshotInfoSchema } from "./schemas";
import { addCommonArgs, cleanupTempFile, cleanupTemporaryKeys, ensurePassfile, parseResticJsonOutput } from "./utils";

export const init = async (config: RepositoryConfig) => {
	await ensurePassfile();

	const repoUrl = buildRepoUrl(config);
	logger.info(`Initializing restic repository at ${repoUrl}...`);

	const env = await buildEnv(config);
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

export const backup = async (
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
	const repoUrl = buildRepoUrl(config);
	const env = await buildEnv(config);

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
		const { createTempFile } = await import("./utils");
		includeFile = await createTempFile("zerobyte-restic-include-", options.include.join("\n"));
		args.push("--files-from", includeFile);
	} else {
		args.push(source);
	}

	for (const exclude of DEFAULT_EXCLUDES) {
		args.push("--exclude", exclude);
	}

	let excludeFile: string | null = null;
	if (options?.exclude && options.exclude.length > 0) {
		const { createTempFile } = await import("./utils");
		excludeFile = await createTempFile("zerobyte-restic-exclude-", options.exclude.join("\n"));
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
			await cleanupTempFile(includeFile);
			await cleanupTempFile(excludeFile);
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
	const result = parseResticJsonOutput(lastLine || "{}", backupOutputSchema, "Restic backup output");

	if (!result) {
		return { result: null, exitCode: res.exitCode };
	}

	return { result, exitCode: res.exitCode };
};

export const restore = async (
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

	const defaultResult = {
		message_type: "summary" as const,
		total_files: 0,
		files_restored: 0,
		files_skipped: 0,
		bytes_skipped: 0,
	};

	if (!lastLine) {
		logger.info(`Restic restore completed for snapshot ${snapshotId} to target ${target}`);
		return defaultResult;
	}

	logger.debug(`Restic restore output last line: ${lastLine}`);
	const result = parseResticJsonOutput(lastLine, restoreOutputSchema, "Restic restore output");

	if (!result) {
		logger.info(`Restic restore completed for snapshot ${snapshotId} to target ${target}`);
		return defaultResult;
	}

	logger.info(
		`Restic restore completed for snapshot ${snapshotId} to target ${target}: ${result.files_restored} restored, ${result.files_skipped} skipped`,
	);

	return result;
};

export const snapshots = async (config: RepositoryConfig, options: { tags?: string[] } = {}) => {
	const { tags } = options;

	const repoUrl = buildRepoUrl(config);
	const env = await buildEnv(config);

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
		logger.error(`Restic snapshots output validation failed: ${result.summary}`);
		throw new Error(`Restic snapshots output validation failed: ${result.summary}`);
	}

	return result;
};

export const ls = async (config: RepositoryConfig, snapshotId: string, path?: string) => {
	const repoUrl = buildRepoUrl(config);
	const env = await buildEnv(config);

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

	const stdout = res.stdout;
	const lines = stdout
		.trim()
		.split("\n")
		.filter((line) => line.trim());

	if (lines.length === 0) {
		return { snapshot: null, nodes: [] };
	}

	const { lsSnapshotInfoSchema, lsNodeSchema } = await import("./schemas");

	// First line is snapshot info
	const snapshot = parseResticJsonOutput(lines[0] ?? "{}", lsSnapshotInfoSchema, "Restic ls snapshot info");

	if (!snapshot) {
		throw new Error("Restic ls snapshot info validation failed");
	}

	// Parse remaining lines as nodes
	const nodes: Array<typeof lsNodeSchema.infer> = [];
	for (let i = 1; i < lines.length; i++) {
		const node = parseResticJsonOutput(lines[i] ?? "{}", lsNodeSchema, "Restic ls node");
		if (node) {
			nodes.push(node);
		}
	}

	return { snapshot, nodes };
};
