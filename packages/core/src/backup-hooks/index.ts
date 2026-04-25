import { Data, Effect } from "effect";
import { z } from "zod";
import { toErrorDetails, toMessage } from "../utils/index.js";

export const DEFAULT_BACKUP_WEBHOOK_TIMEOUT_MS = 60_000;

export const backupWebhookConfigSchema = z.object({
	url: z.url(),
	headers: z.record(z.string(), z.string()).optional(),
	body: z.string().optional(),
});

export const backupWebhooksSchema = z.object({
	pre: backupWebhookConfigSchema.nullable(),
	post: backupWebhookConfigSchema.nullable(),
});

export type BackupWebhookConfig = z.infer<typeof backupWebhookConfigSchema>;
export type BackupWebhooks = z.infer<typeof backupWebhooksSchema>;

export type BackupWebhookPhase = "pre" | "post";
export type BackupWebhookStatus = "success" | "warning" | "error" | "cancelled";

export type BackupWebhookMetadata = {
	jobId: string;
	scheduleId: string;
	organizationId: string;
	sourcePath: string;
};

export type BackupWebhookContext = {
	phase: BackupWebhookPhase;
	event: "backup.pre" | "backup.post";
	jobId: string;
	scheduleId: string;
	organizationId: string;
	sourcePath: string;
	status?: BackupWebhookStatus;
	error?: string;
};

export type BackupOperationResult<TResult> =
	| { status: "completed"; exitCode: number; result: TResult; warningDetails: string | null }
	| { status: "failed"; error: unknown };

export type BackupHookedExecutionResult<TResult> =
	| { status: "completed"; exitCode: number; result: TResult; warningDetails: string | null }
	| { status: "failed"; error: string }
	| { status: "cancelled"; message?: string };

export type BackupHookedExecutionOptions<TResult, R = never> = {
	metadata: BackupWebhookMetadata;
	webhooks: BackupWebhooks;
	signal: AbortSignal;
	runBackup: () => Effect.Effect<BackupOperationResult<TResult>, unknown, R>;
	formatErrorDetails?: (error: unknown) => string;
	formatErrorMessage?: (error: unknown) => string;
};

export class BackupWebhookError extends Data.TaggedError("BackupWebhookError")<{
	cause: unknown;
	message: string;
}> {}

export const createBackupWebhooks = (
	pre: BackupWebhookConfig | null | undefined,
	post: BackupWebhookConfig | null | undefined,
): BackupWebhooks => ({
	pre: pre ?? null,
	post: post ?? null,
});

const createWebhookContext = (
	metadata: BackupWebhookMetadata,
	phase: BackupWebhookPhase,
	status?: BackupWebhookStatus,
	error?: string,
): BackupWebhookContext => {
	const context: BackupWebhookContext = {
		phase,
		event: phase === "pre" ? "backup.pre" : "backup.post",
		...metadata,
	};

	if (status) {
		context.status = status;
	}

	if (error) {
		context.error = error;
	}

	return context;
};

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

	for (const [name, value] of Object.entries(config.headers ?? {})) {
		headers.set(name, value);
	}

	return {
		method: "POST",
		headers,
		body,
	};
};

export const runBackupWebhook = async (
	config: BackupWebhookConfig,
	context: BackupWebhookContext,
	options: { signal?: AbortSignal; timeoutMs?: number } = {},
) => {
	const timeoutMs = options.timeoutMs ?? DEFAULT_BACKUP_WEBHOOK_TIMEOUT_MS;
	const controller = createAbortController(timeoutMs, options.signal);

	try {
		const parsedConfig = backupWebhookConfigSchema.parse(config);
		const url = new URL(parsedConfig.url);

		const response = await fetch(url, {
			...createRequestInit(parsedConfig, context),
			signal: controller.signal,
		});

		if (!response.ok) {
			const responseText = await response.text().catch(() => "");
			const details = responseText.trim().slice(0, 500);
			throw new Error(`${context.phase} webhook returned HTTP ${response.status}${details ? `: ${details}` : ""}`);
		}
	} catch (error) {
		if (controller.signal.aborted && controller.signal.reason instanceof Error) {
			throw new BackupWebhookError({
				cause: controller.signal.reason,
				message: `${context.phase} webhook failed: ${controller.signal.reason.message}`,
			});
		}

		throw new BackupWebhookError({ cause: error, message: `${context.phase} webhook failed: ${toMessage(error)}` });
	} finally {
		controller.cleanup();
	}
};

const runConfiguredWebhook = (
	config: BackupWebhookConfig | null,
	context: BackupWebhookContext,
	formatErrorDetails: (error: unknown) => string,
	signal?: AbortSignal,
) => {
	if (!config) {
		return Effect.succeed(null);
	}

	return Effect.tryPromise({
		try: () => runBackupWebhook(config, context, { signal }),
		catch: (error) => {
			if (error instanceof BackupWebhookError) {
				return error;
			}

			return new BackupWebhookError({ cause: error, message: toMessage(error) });
		},
	}).pipe(
		Effect.as(null),
		Effect.catchAll((error) => Effect.succeed(formatErrorDetails(error))),
	);
};

export const runBackupWithWebhooks = <TResult, R = never>({
	metadata,
	webhooks,
	signal,
	runBackup,
	formatErrorDetails = toErrorDetails,
	formatErrorMessage = toMessage,
}: BackupHookedExecutionOptions<TResult, R>): Effect.Effect<BackupHookedExecutionResult<TResult>, never, R> =>
	Effect.gen(function* () {
		const preHookError = yield* runConfiguredWebhook(
			webhooks.pre,
			createWebhookContext(metadata, "pre"),
			formatErrorDetails,
			signal,
		);
		if (preHookError) {
			if (signal.aborted) {
				return { status: "cancelled", message: formatErrorMessage(signal.reason) };
			}

			return { status: "failed", error: preHookError };
		}

		const backupResult = yield* Effect.suspend(runBackup).pipe(
			Effect.catchAll((error) => Effect.succeed({ status: "failed" as const, error })),
		);

		if (backupResult.status === "completed") {
			const hookStatus = getCompletedStatus(backupResult.exitCode, signal);
			const postHookError = yield* runConfiguredWebhook(
				webhooks.post,
				createWebhookContext(metadata, "post", hookStatus, backupResult.warningDetails ?? undefined),
				formatErrorDetails,
				signal,
			);

			if (signal.aborted) {
				return { status: "cancelled", message: formatErrorMessage(signal.reason) };
			}

			return {
				status: "completed",
				exitCode: backupResult.exitCode,
				result: backupResult.result,
				warningDetails: appendDetails(backupResult.warningDetails, postHookError) || null,
			};
		}

		const errorDetails = formatErrorDetails(backupResult.error);
		const postHookError = yield* runConfiguredWebhook(
			webhooks.post,
			createWebhookContext(metadata, "post", signal.aborted ? "cancelled" : "error", errorDetails),
			formatErrorDetails,
			signal,
		);

		if (signal.aborted) {
			return {
				status: "cancelled",
				message: appendDetails(formatErrorMessage(signal.reason || backupResult.error), postHookError) || undefined,
			};
		}

		return {
			status: "failed",
			error: appendDetails(errorDetails, postHookError) || errorDetails,
		};
	});
