import { Data, Effect } from "effect";
import { z } from "zod";
import type { CompressionMode, RepositoryConfig, ResticBackupProgressDto } from "../restic/index.js";
import { toErrorDetails, toMessage } from "../utils/index.js";

const DEFAULT_BACKUP_WEBHOOK_TIMEOUT_MS = 60_000;

export const backupWebhookConfigSchema = z.object({
	url: z.url(),
	headers: z.array(z.string()).optional(),
	body: z.string().optional(),
});

export const backupWebhooksSchema = z.object({
	pre: backupWebhookConfigSchema.nullable(),
	post: backupWebhookConfigSchema.nullable(),
});

export type BackupWebhookConfig = z.infer<typeof backupWebhookConfigSchema>;
export type BackupWebhooks = z.infer<typeof backupWebhooksSchema>;

type BackupWebhookPhase = "pre" | "post";
type BackupWebhookStatus = "success" | "warning" | "error" | "cancelled";

type BackupWebhookContext = {
	phase: BackupWebhookPhase;
	event: "backup.pre" | "backup.post";
	jobId: string;
	scheduleId: string;
	organizationId: string;
	sourcePath: string;
	status?: BackupWebhookStatus;
	error?: string;
};

type BackupResult<TResult> = { exitCode: number; result: TResult; warningDetails: string | null };

type BackupLifecycleResult<TResult> =
	| { status: "completed"; exitCode: number; result: TResult; warningDetails: string | null }
	| { status: "failed"; error: string }
	| { status: "cancelled"; message?: string };

type BackupOptions = {
	tags?: string[];
	oneFileSystem?: boolean;
	exclude?: string[];
	excludeIfPresent?: string[];
	includePaths?: string[];
	includePatterns?: string[];
	customResticParams?: string[];
	compressionMode?: CompressionMode;
};

type BackupLifecycleOptions<TResult> = {
	jobId: string;
	scheduleId: string;
	organizationId: string;
	sourcePath: string;
	restic: {
		backup: (
			config: RepositoryConfig,
			sourcePath: string,
			options: BackupOptions & {
				organizationId: string;
				signal: AbortSignal;
				onProgress?: (progress: ResticBackupProgressDto) => void;
			},
		) => Effect.Effect<BackupResult<TResult>, unknown>;
	};
	repositoryConfig: RepositoryConfig;
	options: BackupOptions;
	webhooks: BackupWebhooks;
	signal: AbortSignal;
	onProgress?: (progress: ResticBackupProgressDto) => void;
	formatError?: (error: unknown) => string;
};

class BackupWebhookError extends Data.TaggedError("BackupWebhookError")<{
	cause: unknown;
	message: string;
}> {}

const appendDetails = (primary: string | null | undefined, next: string | null | undefined) => {
	return [primary, next].filter(Boolean).join("\n\n");
};

const getCompletedStatus = (exitCode: number, signal: AbortSignal): BackupWebhookStatus => {
	if (signal.aborted) {
		return "cancelled";
	}

	return exitCode === 0 ? "success" : "warning";
};

const createAbortController = (timeoutMs: number, signal?: AbortSignal) => {
	const abortController = new AbortController();
	const timeout = setTimeout(() => {
		abortController.abort(new Error(`Webhook timed out after ${Math.round(timeoutMs / 1000)} seconds`));
	}, timeoutMs);

	const abortFromSignal = () => {
		abortController.abort(signal?.reason || new Error("Operation aborted"));
	};

	if (signal?.aborted) {
		abortFromSignal();
	} else {
		signal?.addEventListener("abort", abortFromSignal, { once: true });
	}

	return {
		signal: abortController.signal,
		cleanup: () => {
			clearTimeout(timeout);
			signal?.removeEventListener("abort", abortFromSignal);
		},
	};
};

const createRequestInit = (config: BackupWebhookConfig, context: BackupWebhookContext): RequestInit => {
	const headers = new Headers();
	const body = config.body ?? JSON.stringify(context);

	if (config.body === undefined) {
		headers.set("content-type", "application/json");
	}

	for (const header of config.headers ?? []) {
		const [name, ...valueParts] = header.split(":");

		if (name && valueParts.length > 0) {
			headers.set(name.trim(), valueParts.join(":").trim());
		}
	}

	return { method: "POST", headers, body };
};

const runBackupWebhook = (
	config: BackupWebhookConfig | null,
	context: BackupWebhookContext,
	options: {
		formatError: (error: unknown) => string;
		signal?: AbortSignal;
		timeoutMs?: number;
	},
) =>
	Effect.suspend(() => {
		if (!config) {
			return Effect.succeed(null);
		}

		const timeoutMs = options.timeoutMs ?? DEFAULT_BACKUP_WEBHOOK_TIMEOUT_MS;
		const controller = createAbortController(timeoutMs, options.signal);

		return Effect.tryPromise({
			try: async () => {
				const response = await fetch(config.url, { ...createRequestInit(config, context), signal: controller.signal });

				if (!response.ok) {
					const responseText = await response.text().catch(() => "");
					const details = responseText.trim().slice(0, 500);
					throw new BackupWebhookError({
						cause: new Error(`${context.phase} webhook returned HTTP ${response.status}`),
						message: `${context.phase} webhook returned HTTP ${response.status}${details ? `: ${details}` : ""}`,
					});
				}
			},
			catch: (error) => {
				if (error instanceof BackupWebhookError) {
					return error;
				}

				if (controller.signal.aborted && controller.signal.reason instanceof Error) {
					return new BackupWebhookError({
						cause: controller.signal.reason,
						message: `${context.phase} webhook failed: ${controller.signal.reason.message}`,
					});
				}

				return new BackupWebhookError({
					cause: error,
					message: `${context.phase} webhook failed: ${toMessage(error)}`,
				});
			},
		}).pipe(
			Effect.as(null),
			Effect.catchAll((error) => Effect.succeed(options.formatError(error))),
			Effect.ensuring(Effect.sync(controller.cleanup)),
		);
	});

export const runBackupLifecycle = <TResult>({
	jobId,
	scheduleId,
	organizationId,
	sourcePath,
	restic,
	repositoryConfig,
	options,
	webhooks,
	signal,
	onProgress,
	formatError = toErrorDetails,
}: BackupLifecycleOptions<TResult>): Effect.Effect<BackupLifecycleResult<TResult>, never> =>
	Effect.gen(function* () {
		const context = { jobId, scheduleId, organizationId, sourcePath };
		const preHookError = yield* runBackupWebhook(
			webhooks.pre,
			{ ...context, phase: "pre", event: "backup.pre" },
			{
				formatError,
				signal,
			},
		);
		if (preHookError) {
			if (signal.aborted) {
				return { status: "cancelled", message: formatError(signal.reason) };
			}

			return { status: "failed", error: preHookError };
		}
		if (signal.aborted) {
			return { status: "cancelled", message: formatError(signal.reason) };
		}

		const backupResult = yield* Effect.suspend(() =>
			restic.backup(repositoryConfig, sourcePath, { ...options, organizationId, signal, onProgress }),
		).pipe(
			Effect.map((result) => ({
				status: "completed" as const,
				...result,
				hookStatus: getCompletedStatus(result.exitCode, signal),
				hookError: signal.aborted ? formatError(signal.reason) : (result.warningDetails ?? undefined),
			})),
			Effect.catchAll((error) => {
				const errorDetails = formatError(error);

				return Effect.succeed({
					status: "failed" as const,
					errorDetails,
					hookStatus: signal.aborted ? ("cancelled" as const) : ("error" as const),
					hookError: errorDetails,
				});
			}),
		);

		const postHookError = yield* runBackupWebhook(
			webhooks.post,
			{
				...context,
				phase: "post",
				event: "backup.post",
				status: backupResult.hookStatus,
				error: backupResult.hookError,
			},
			{ formatError },
		);

		if (signal.aborted) {
			return {
				status: "cancelled",
				message: appendDetails(formatError(signal.reason || backupResult.hookError), postHookError) || undefined,
			};
		}

		if (backupResult.status === "completed") {
			return {
				status: "completed",
				exitCode: backupResult.exitCode,
				result: backupResult.result,
				warningDetails: appendDetails(backupResult.warningDetails, postHookError) || null,
			};
		}

		return {
			status: "failed",
			error: appendDetails(backupResult.errorDetails, postHookError) || backupResult.errorDetails,
		};
	});
