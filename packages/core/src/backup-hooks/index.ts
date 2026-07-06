import http from "node:http";
import https from "node:https";
import { Data, Effect } from "effect";
import { z } from "zod";
import type { CompressionMode, RepositoryConfig, ResticBackupProgressDto } from "../restic/index.js";
import { toErrorDetails, toMessage } from "../utils/index.js";

const MAX_BACKUP_WEBHOOK_BODY_BYTES = 64 * 1024;
const MAX_BACKUP_WEBHOOK_HEADERS = 32;
const MAX_BACKUP_WEBHOOK_HEADER_BYTES = 8 * 1024;
const HEADER_NAME_PATTERN = /^[A-Za-z0-9-]+$/;

const getByteLength = (value: string) => new TextEncoder().encode(value).byteLength;
const getUrlOrigin = (url: string) => (URL.canParse(url) ? new URL(url).origin : null);
const isValidHeaderLine = (header: string) => {
	const [key, value] = header.split(":", 2);

	return !!key && HEADER_NAME_PATTERN.test(key.trim()) && (value?.trim().length ?? 0) > 0;
};

export const isAllowedWebhookUrl = (url: string, allowedOrigins: readonly string[]) => {
	const webhookOrigin = getUrlOrigin(url);
	return webhookOrigin !== null && allowedOrigins.some((origin) => getUrlOrigin(origin) === webhookOrigin);
};

export const backupWebhookConfigSchema = z.object({
	url: z.url(),
	headers: z
		.array(
			z
				.string()
				.refine(isValidHeaderLine, "Headers must use non-empty Key: Value format with valid header names"),
		)
		.optional(),
	body: z.string().optional(),
	insecureTls: z.boolean().optional(),
});

export type BackupWebhookConfig = z.infer<typeof backupWebhookConfigSchema>;

export const backupWebhooksSchema = z.object({
	pre: backupWebhookConfigSchema.nullable(),
	post: backupWebhookConfigSchema.nullable(),
});

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
	webhookAllowedOrigins: readonly string[];
	webhookTimeoutMs: number;
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

const getCompletedStatus = (
	exitCode: number,
	warningDetails: string | null,
	signal: AbortSignal,
): BackupWebhookStatus => {
	if (signal.aborted) {
		return "cancelled";
	}

	return exitCode === 0 && !warningDetails ? "success" : "warning";
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

const createWebhookRequest = (config: BackupWebhookConfig, context: BackupWebhookContext) => {
	const headers = new Headers();
	const body = config.body ?? JSON.stringify(context);

	if (getByteLength(body) > MAX_BACKUP_WEBHOOK_BODY_BYTES) {
		throw new BackupWebhookError({
			cause: new Error("Webhook request body is too large"),
			message: `Webhook request body exceeds ${MAX_BACKUP_WEBHOOK_BODY_BYTES} bytes`,
		});
	}

	if (config.body === undefined) {
		headers.set("content-type", "application/json");
	}

	if ((config.headers?.length ?? 0) > MAX_BACKUP_WEBHOOK_HEADERS) {
		throw new BackupWebhookError({
			cause: new Error("Webhook request has too many headers"),
			message: `Webhook request exceeds ${MAX_BACKUP_WEBHOOK_HEADERS} custom headers`,
		});
	}

	for (const header of config.headers ?? []) {
		const [name, ...valueParts] = header.split(":");

		if (name && valueParts.length > 0) {
			headers.set(name.trim(), valueParts.join(":").trim());
		}
	}

	const headerBytes = [...headers.entries()].reduce(
		(total, [name, value]) => total + getByteLength(name) + getByteLength(value),
		0,
	);

	if (headerBytes > MAX_BACKUP_WEBHOOK_HEADER_BYTES) {
		throw new BackupWebhookError({
			cause: new Error("Webhook request headers are too large"),
			message: `Webhook request headers exceed ${MAX_BACKUP_WEBHOOK_HEADER_BYTES} bytes`,
		});
	}

	return {
		headers,
		body: config.body === undefined ? body : new TextEncoder().encode(body),
	};
};

const sendWebhookRequest = (
	config: BackupWebhookConfig,
	context: BackupWebhookContext,
	{ signal, timeoutMs }: { signal: AbortSignal; timeoutMs: number },
) =>
	new Promise<void>((resolve, reject) => {
		const url = new URL(config.url);
		const client = url.protocol === "http:" ? http : url.protocol === "https:" ? https : null;

		if (!client) {
			reject(new Error(`Unsupported webhook URL protocol ${url.protocol}`));
			return;
		}

		const request = createWebhookRequest(config, context);
		const headers = Object.fromEntries(request.headers.entries());
		if (!request.headers.has("content-length")) {
			headers["content-length"] = String(
				getByteLength(typeof request.body === "string" ? request.body : (config.body ?? "")),
			);
		}

		const requestOptions: https.RequestOptions = { method: "POST", headers };
		if (client === https && config.insecureTls) {
			requestOptions.rejectUnauthorized = false;
		}

		let settled = false;

		const settle = (callback: () => void) => {
			if (settled) return;
			settled = true;
			signal.removeEventListener("abort", abortRequest);
			callback();
		};

		const req = client.request(url, requestOptions, (res) => {
			res.resume();
			res.on("error", (error) => settle(() => reject(error)));
			res.on("end", () => {
				const statusCode = res.statusCode ?? 0;

				if (statusCode >= 200 && statusCode < 300) {
					settle(resolve);
					return;
				}

				settle(() =>
					reject(
						new BackupWebhookError({
							cause: new Error(`${context.phase} webhook returned HTTP ${statusCode}`),
							message: `${context.phase} webhook returned HTTP ${statusCode}`,
						}),
					),
				);
			});
		});

		const abortRequest = () => {
			const error = signal.reason || new Error("Operation aborted");
			settle(() => reject(error));
			req.destroy(error);
		};

		req.setTimeout(timeoutMs, () => {
			const error = new Error(`Webhook timed out after ${Math.round(timeoutMs / 1000)} seconds`);
			settle(() => reject(error));
			req.destroy(error);
		});

		req.on("error", (error) => settle(() => reject(error)));

		if (signal.aborted) {
			abortRequest();
			return;
		}

		signal.addEventListener("abort", abortRequest, { once: true });
		req.end(request.body);
	});

const runBackupWebhook = (
	config: BackupWebhookConfig | null,
	context: BackupWebhookContext,
	options: {
		formatError: (error: unknown) => string;
		allowedOrigins: readonly string[];
		signal?: AbortSignal;
		timeoutMs: number;
	},
) =>
	Effect.suspend(() => {
		if (!config) {
			return Effect.succeed(null);
		}

		const controller = createAbortController(options.timeoutMs, options.signal);

		return Effect.tryPromise({
			try: async () => {
				if (!isAllowedWebhookUrl(config.url, options.allowedOrigins)) {
					const webhookOrigin = getUrlOrigin(config.url);
					throw new BackupWebhookError({
						cause: new Error("Webhook URL origin is not allowed"),
						message: `${context.phase} webhook URL origin is not allowed. Add ${
							webhookOrigin ?? config.url
						} to WEBHOOK_ALLOWED_ORIGINS.`,
					});
				}

				await sendWebhookRequest(config, context, {
					signal: controller.signal,
					timeoutMs: options.timeoutMs,
				});
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
	webhookAllowedOrigins,
	webhookTimeoutMs,
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
				allowedOrigins: webhookAllowedOrigins,
				timeoutMs: webhookTimeoutMs,
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
				hookStatus: getCompletedStatus(result.exitCode, result.warningDetails, signal),
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
			{ formatError, allowedOrigins: webhookAllowedOrigins, timeoutMs: webhookTimeoutMs },
		);

		if (signal.aborted) {
			return {
				status: "cancelled",
				message:
					appendDetails(formatError(signal.reason || backupResult.hookError), postHookError) || undefined,
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
