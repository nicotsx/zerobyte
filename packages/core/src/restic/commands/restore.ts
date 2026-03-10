import path from "node:path";
import { z } from "zod";
import { throttle } from "es-toolkit";
import { findCommonAncestor } from "../../utils/common-ancestor";
import { addCommonArgs } from "../helpers/add-common-args";
import { buildEnv } from "../helpers/build-env";
import { buildRepoUrl } from "../helpers/build-repo-url";
import { cleanupTemporaryKeys } from "../helpers/cleanup-temporary-keys";
import { type RepositoryConfig, type OverwriteMode } from "../schemas";
import { logger, safeSpawn } from "../../utils";
import { ResticError } from "../error";
import { resticRestoreOutputSchema, type ResticRestoreOutputDto } from "../restic-dto";
import type { ResticDeps } from "../types";

const restoreProgressSchema = z.object({
	message_type: z.enum(["status", "summary"]),
	seconds_elapsed: z.number(),
	percent_done: z.number().default(0),
	total_files: z.number(),
	files_restored: z.number().default(0),
	total_bytes: z.number().default(0),
	bytes_restored: z.number().default(0),
});

export type RestoreProgress = z.infer<typeof restoreProgressSchema>;

export const restore = async (
	config: RepositoryConfig,
	snapshotId: string,
	target: string,
	options: {
		basePath?: string;
		organizationId: string;
		include?: string[];
		selectedItemKind?: "file" | "dir";
		exclude?: string[];
		excludeXattr?: string[];
		delete?: boolean;
		overwrite?: OverwriteMode;
		onProgress?: (progress: RestoreProgress) => void;
		signal?: AbortSignal;
	},
	deps: ResticDeps,
) => {
	const repoUrl = buildRepoUrl(config);
	const env = await buildEnv(config, options.organizationId, deps);

	let restoreArg = snapshotId;

	const includes = options.include?.length ? options.include : [options.basePath ?? "/"];
	const commonAncestor =
		options.selectedItemKind === "file" && includes.length === 1
			? path.posix.dirname(includes[0] ?? "/")
			: findCommonAncestor(includes);

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
			const strippedIncludes = options.include.map((pattern) => path.posix.relative(commonAncestor, pattern));
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
				if (jsonData.message_type !== "status") {
					return;
				}

				const progress = restoreProgressSchema.safeParse(jsonData);
				if (progress.success) {
					options.onProgress(progress.data);
				} else {
					logger.error(progress.error.message);
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

	await cleanupTemporaryKeys(env, deps);

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
	const result = resticRestoreOutputSchema.safeParse(summaryLine);

	if (!result.success) {
		logger.warn(`Restic restore output validation failed: ${result.error.message}`);
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
		`Restic restore completed for snapshot ${snapshotId} to target ${target}: ${result.data.files_restored} restored, ${result.data.files_skipped} skipped`,
	);

	return result.data;
};
