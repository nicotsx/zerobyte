import path from "node:path";
import { type } from "arktype";
import { throttle } from "es-toolkit";
import type { OverwriteMode, RepositoryConfig } from "~/schemas/restic";
import type { ResticRestoreOutputDto } from "~/schemas/restic-dto";
import { resticRestoreOutputSchema } from "~/schemas/restic-dto";
import { findCommonAncestor } from "~/utils/common-ancestor";
import { ResticError } from "~/server/utils/errors";
import { logger } from "~/server/utils/logger";
import { safeSpawn } from "~/server/utils/spawn";
import { addCommonArgs } from "../helpers/add-common-args";
import { buildEnv } from "../helpers/build-env";
import { buildRepoUrl } from "../helpers/build-repo-url";
import { cleanupTemporaryKeys } from "../helpers/cleanup-temporary-keys";

const restoreProgressSchema = type({
	message_type: "'status' | 'summary'",
	seconds_elapsed: "number",
	percent_done: "number = 0",
	total_files: "number",
	files_restored: "number = 0",
	total_bytes: "number = 0",
	bytes_restored: "number = 0",
});

export type RestoreProgress = typeof restoreProgressSchema.infer;

export const restore = async (
	config: RepositoryConfig,
	snapshotId: string,
	target: string,
	options: {
		basePath?: string;
		organizationId: string;
		include?: string[];
		exclude?: string[];
		excludeXattr?: string[];
		delete?: boolean;
		overwrite?: OverwriteMode;
		onProgress?: (progress: RestoreProgress) => void;
		signal?: AbortSignal;
	},
) => {
	const repoUrl = buildRepoUrl(config);
	const env = await buildEnv(config, options.organizationId);

	let restoreArg = snapshotId;

	const includes = options.include?.length ? options.include : [options.basePath ?? "/"];
	const commonAncestor = findCommonAncestor(includes);
	if (target !== "/") {
		restoreArg = `${snapshotId}:${commonAncestor}`;
	}

	const args = ["--repo", repoUrl, "restore", restoreArg, "--target", target];

	if (options.overwrite) {
		args.push("--overwrite", options.overwrite);
	}

	if (options.include?.length) {
		if (target === "/") {
			for (const pattern of options.include) {
				args.push("--include", pattern);
			}
		} else {
			const strippedIncludes = options.include.map((pattern) => path.relative(commonAncestor, pattern));
			const includesCoverRestoreRoot = strippedIncludes.some((pattern) => pattern === "" || pattern === ".");

			if (!includesCoverRestoreRoot) {
				for (const pattern of strippedIncludes) {
					if (pattern !== "" && pattern !== ".") {
						args.push("--include", pattern);
					}
				}
			}
		}
	}

	if (options.exclude && options.exclude.length > 0) {
		for (const pattern of options.exclude) {
			args.push("--exclude", pattern);
		}
	}

	if (options.excludeXattr && options.excludeXattr.length > 0) {
		for (const xattr of options.excludeXattr) {
			args.push("--exclude-xattr", xattr);
		}
	}

	addCommonArgs(args, env, config);

	const streamProgress = throttle((data: string) => {
		if (options.onProgress) {
			try {
				const jsonData = JSON.parse(data);
				const progress = restoreProgressSchema(jsonData);
				if (!(progress instanceof type.errors)) {
					options.onProgress(progress);
				} else {
					logger.error(progress.summary);
				}
			} catch {
				// Ignore JSON parse errors for non-JSON lines
			}
		}
	}, 1000);

	logger.debug(`Executing: restic ${args.join(" ")}`);
	const res = await safeSpawn({
		command: "restic",
		args,
		env,
		signal: options.signal,
		onStdout: (data) => {
			if (options.onProgress) {
				streamProgress(data);
			}
		},
	});

	await cleanupTemporaryKeys(env);

	if (res.exitCode !== 0) {
		logger.error(`Restic restore failed: ${res.error}`);
		throw new ResticError(res.exitCode, res.error);
	}

	const lastLine = res.summary.trim();
	let summaryLine: unknown = {};
	try {
		summaryLine = JSON.parse(lastLine ?? "{}");
	} catch {
		logger.warn("Failed to parse restic restore output JSON summary.", lastLine);
		summaryLine = {};
	}

	logger.debug(`Restic restore output last line: ${JSON.stringify(summaryLine)}`);
	const result = resticRestoreOutputSchema(summaryLine);

	if (result instanceof type.errors) {
		logger.warn(`Restic restore output validation failed: ${result.summary}`);
		logger.info(`Restic restore completed for snapshot ${snapshotId} to target ${target}`);
		const fallback: ResticRestoreOutputDto = {
			message_type: "summary" as const,
			total_files: 0,
			files_restored: 0,
			files_skipped: 0,
			bytes_skipped: 0,
		};

		return fallback;
	}

	logger.info(
		`Restic restore completed for snapshot ${snapshotId} to target ${target}: ${result.files_restored} restored, ${result.files_skipped} skipped`,
	);

	return result;
};
