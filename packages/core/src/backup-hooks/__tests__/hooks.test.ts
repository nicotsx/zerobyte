import nodeHttp, { type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { Effect } from "effect";
import { afterEach, beforeEach, expect, test } from "vitest";
import { backupWebhookConfigSchema, runBackupLifecycle } from "../index.js";

type WebhookHandler = (context: {
	request: IncomingMessage;
	response: ServerResponse;
	body: string;
}) => void | Promise<void>;

let webhookServer: Server;
let webhookOrigin = "";
let webhookHandlers = new Map<string, WebhookHandler>();

const routeKey = (method: string, path: string) => `${method} ${path}`;
const webhookUrl = (path: string) => `${webhookOrigin}${path}`;
const postWebhook = (path: string, handler: WebhookHandler) => ({ key: routeKey("POST", path), handler });
const useWebhookHandlers = (...handlers: ReturnType<typeof postWebhook>[]) => {
	webhookHandlers = new Map(handlers.map(({ key, handler }) => [key, handler]));
};
const sendWebhookResponse = (response: ServerResponse, status = 204, body = "") => {
	response.writeHead(status);
	response.end(body);
};

beforeEach(async () => {
	webhookHandlers = new Map();
	webhookServer = nodeHttp.createServer(async (request, response) => {
		const chunks: Buffer[] = [];
		for await (const chunk of request) chunks.push(Buffer.from(chunk));

		const body = Buffer.concat(chunks).toString("utf8");
		const pathname = new URL(request.url ?? "/", webhookOrigin).pathname;
		const handler = webhookHandlers.get(routeKey(request.method ?? "", pathname));

		if (!handler) {
			sendWebhookResponse(response, 404);
			return;
		}

		await handler({ request, response, body });
	});

	await new Promise<void>((resolve) => {
		webhookServer.listen(0, "127.0.0.1", resolve);
	});

	const address = webhookServer.address();
	if (!address || typeof address === "string") {
		throw new Error("Failed to bind test webhook server");
	}

	webhookOrigin = `http://127.0.0.1:${address.port}`;
});

afterEach(async () => {
	webhookServer.closeAllConnections?.();
	if (webhookServer.listening) {
		await new Promise<void>((resolve, reject) => {
			webhookServer.close((error) => (error ? reject(error) : resolve()));
		});
	}
});

const metadata = {
	jobId: "job-1",
	scheduleId: "schedule-1",
	organizationId: "org-1",
	sourcePath: "/tmp/source",
};

const defaultSignal = () => new AbortController().signal;

const completedBackup = <TResult>(result: TResult, exitCode = 0, warningDetails: string | null = null) =>
	Effect.succeed({ exitCode, result, warningDetails });

const runWithHooks = <TResult>(
	overrides: Omit<Partial<Parameters<typeof runBackupLifecycle<TResult>>[0]>, "restic"> & {
		runBackup: () => Effect.Effect<{ exitCode: number; result: TResult; warningDetails: string | null }, unknown>;
	},
) => {
	const { runBackup, ...options } = overrides;

	return Effect.runPromise(
		runBackupLifecycle({
			...metadata,
			restic: { backup: runBackup },
			repositoryConfig: { backend: "local", path: "/tmp/repository" },
			options: {},
			webhooks: { pre: null, post: null },
			webhookAllowedOrigins: [webhookOrigin],
			webhookTimeoutMs: 60_000,
			signal: defaultSignal(),
			...options,
		}),
	);
};

type WebhookBody = {
	phase?: string;
	event?: string;
	jobId?: string;
	scheduleId?: string;
	organizationId?: string;
	sourcePath?: string;
	status?: string;
	error?: string;
};

test("runs pre and post webhooks around a successful backup", async () => {
	const events: string[] = [];
	let preBody: WebhookBody | undefined;
	let postBody: WebhookBody | undefined;

	useWebhookHandlers(
		postWebhook("/pre", ({ body, response }) => {
			events.push("pre");
			preBody = JSON.parse(body) as WebhookBody;
			sendWebhookResponse(response);
		}),
		postWebhook("/post", ({ body, response }) => {
			events.push("post");
			postBody = JSON.parse(body) as WebhookBody;
			sendWebhookResponse(response);
		}),
	);

	const result = await runWithHooks({
		webhooks: {
			pre: { url: webhookUrl("/pre") },
			post: { url: webhookUrl("/post") },
		},
		runBackup: () =>
			Effect.sync(() => {
				events.push("backup");
				return { exitCode: 0, result: "snapshot-1", warningDetails: null };
			}),
	});

	expect(events).toEqual(["pre", "backup", "post"]);
	expect(preBody).toMatchObject({ ...metadata, phase: "pre", event: "backup.pre" });
	expect(postBody).toMatchObject({ ...metadata, phase: "post", event: "backup.post", status: "success" });
	expect(result).toEqual({ status: "completed", exitCode: 0, result: "snapshot-1", warningDetails: null });
});

test("sends warning details to the post-backup webhook for a non-zero completed backup", async () => {
	let postBody: WebhookBody | undefined;

	useWebhookHandlers(
		postWebhook("/post", ({ body, response }) => {
			postBody = JSON.parse(body) as WebhookBody;
			sendWebhookResponse(response);
		}),
	);

	const result = await runWithHooks({
		webhooks: {
			pre: null,
			post: { url: webhookUrl("/post") },
		},
		runBackup: () => completedBackup("snapshot-1", 3, "some files could not be read"),
	});

	expect(postBody).toMatchObject({ status: "warning", error: "some files could not be read" });
	expect(result).toEqual({
		status: "completed",
		exitCode: 3,
		result: "snapshot-1",
		warningDetails: "some files could not be read",
	});
});

test("sends warning details to the post-backup webhook for a zero-exit completed backup with warnings", async () => {
	let postBody: WebhookBody | undefined;

	useWebhookHandlers(
		postWebhook("/post", ({ body, response }) => {
			postBody = JSON.parse(body) as WebhookBody;
			sendWebhookResponse(response);
		}),
	);

	const result = await runWithHooks({
		webhooks: {
			pre: null,
			post: { url: webhookUrl("/post") },
		},
		runBackup: () => completedBackup("snapshot-1", 0, "Backup was stopped by the user"),
	});

	expect(postBody).toMatchObject({ status: "warning", error: "Backup was stopped by the user" });
	expect(result).toEqual({
		status: "completed",
		exitCode: 0,
		result: "snapshot-1",
		warningDetails: "Backup was stopped by the user",
	});
});

test("sends error details to the post-backup webhook when the backup fails", async () => {
	let postBody: WebhookBody | undefined;

	useWebhookHandlers(
		postWebhook("/post", ({ body, response }) => {
			postBody = JSON.parse(body) as WebhookBody;
			sendWebhookResponse(response);
		}),
	);

	const result = await runWithHooks({
		webhooks: {
			pre: null,
			post: { url: webhookUrl("/post") },
		},
		runBackup: () => Effect.fail(new Error("restic failed")),
	});

	expect(postBody).toMatchObject({ status: "error", error: "restic failed" });
	expect(result).toEqual({ status: "failed", error: "restic failed" });
});

test("fails without running the backup or post webhook when the pre-backup webhook fails", async () => {
	let backupRan = false;
	let postRan = false;

	useWebhookHandlers(
		postWebhook("/pre", ({ response }) => {
			sendWebhookResponse(response, 500, "stop failed");
		}),
		postWebhook("/post", ({ response }) => {
			postRan = true;
			sendWebhookResponse(response);
		}),
	);

	const result = await runWithHooks({
		webhooks: {
			pre: { url: webhookUrl("/pre") },
			post: { url: webhookUrl("/post") },
		},
		runBackup: () =>
			Effect.sync(() => {
				backupRan = true;
				return { exitCode: 0, result: null, warningDetails: null };
			}),
	});

	expect(backupRan).toBe(false);
	expect(postRan).toBe(false);
	expect(result.status).toBe("failed");
	if (result.status === "failed") {
		expect(result.error).toContain("pre webhook returned HTTP 500");
		expect(result.error).not.toContain("stop failed");
	}
});

test("sends configured webhook headers and body without replacing them", async () => {
	let body: string | undefined;
	let authorization: string | null | undefined;
	let contentType: string | null | undefined;

	useWebhookHandlers(
		postWebhook("/post", ({ request, response, body: requestBody }) => {
			body = requestBody;
			authorization = Array.isArray(request.headers.authorization)
				? request.headers.authorization.join(", ")
				: request.headers.authorization;
			contentType = Array.isArray(request.headers["content-type"])
				? request.headers["content-type"].join(", ")
				: (request.headers["content-type"] ?? null);
			sendWebhookResponse(response);
		}),
	);

	await runWithHooks({
		webhooks: {
			pre: null,
			post: {
				url: webhookUrl("/post"),
				headers: ["authorization: Bearer post-token"],
				body: "start-container",
			},
		},
		runBackup: () => completedBackup(null),
	});

	expect(body).toBe("start-container");
	expect(authorization).toBe("Bearer post-token");
	expect(contentType).toBeNull();
});

test("runs the post-backup webhook after cancellation without using the cancelled signal", async () => {
	const abortController = new AbortController();
	let postBody: { status?: string; error?: string } | undefined;

	useWebhookHandlers(
		postWebhook("/post", ({ body, response }) => {
			postBody = JSON.parse(body) as { status?: string; error?: string };
			sendWebhookResponse(response);
		}),
	);

	const result = await runWithHooks({
		webhooks: {
			pre: null,
			post: { url: webhookUrl("/post") },
		},
		signal: abortController.signal,
		runBackup: () =>
			Effect.gen(function* () {
				abortController.abort(new Error("Backup was cancelled"));
				return yield* Effect.fail(new Error("restic cancelled"));
			}),
	});

	expect(postBody).toMatchObject({ status: "cancelled", error: "restic cancelled" });
	expect(result).toEqual({ status: "cancelled", message: "Backup was cancelled" });
});

test("runs the post-backup webhook when cancellation returns a completed backup result", async () => {
	const abortController = new AbortController();
	let postBody: { status?: string; error?: string } | undefined;

	useWebhookHandlers(
		postWebhook("/post", ({ body, response }) => {
			postBody = JSON.parse(body) as { status?: string; error?: string };
			sendWebhookResponse(response);
		}),
	);

	const result = await runWithHooks({
		webhooks: {
			pre: null,
			post: { url: webhookUrl("/post") },
		},
		signal: abortController.signal,
		runBackup: () =>
			Effect.sync(() => {
				abortController.abort(new Error("Backup was cancelled"));
				return { exitCode: 0, result: null, warningDetails: null };
			}),
	});

	expect(postBody).toMatchObject({ status: "cancelled" });
	expect(result).toEqual({ status: "cancelled", message: "Backup was cancelled" });
});

test("includes post-backup webhook failure details after cancellation", async () => {
	const abortController = new AbortController();
	let postBody: { status?: string; error?: string } | undefined;

	useWebhookHandlers(
		postWebhook("/post", ({ body, response }) => {
			postBody = JSON.parse(body) as { status?: string; error?: string };
			sendWebhookResponse(response, 500, "start failed");
		}),
	);

	const result = await runWithHooks({
		webhooks: {
			pre: null,
			post: { url: webhookUrl("/post") },
		},
		signal: abortController.signal,
		runBackup: () =>
			Effect.gen(function* () {
				abortController.abort(new Error("Backup was cancelled"));
				return yield* Effect.fail(new Error("restic cancelled"));
			}),
	});

	expect(postBody).toMatchObject({ status: "cancelled", error: "restic cancelled" });
	expect(result.status).toBe("cancelled");
	if (result.status === "cancelled") {
		expect(result.message).toContain("Backup was cancelled");
		expect(result.message).toContain("post webhook returned HTTP 500");
		expect(result.message).not.toContain("start failed");
	}
});

test("includes post-backup webhook failure details after completed cancellation", async () => {
	const abortController = new AbortController();
	let postBody: { status?: string; error?: string } | undefined;

	useWebhookHandlers(
		postWebhook("/post", ({ body, response }) => {
			postBody = JSON.parse(body) as { status?: string; error?: string };
			sendWebhookResponse(response, 500, "cleanup failed");
		}),
	);

	const result = await runWithHooks({
		webhooks: {
			pre: null,
			post: { url: webhookUrl("/post") },
		},
		signal: abortController.signal,
		runBackup: () =>
			Effect.sync(() => {
				abortController.abort(new Error("Backup was cancelled"));
				return { exitCode: 0, result: null, warningDetails: null };
			}),
	});

	expect(postBody).toMatchObject({ status: "cancelled", error: "Backup was cancelled" });
	expect(result.status).toBe("cancelled");
	if (result.status === "cancelled") {
		expect(result.message).toContain("Backup was cancelled");
		expect(result.message).toContain("post webhook returned HTTP 500");
		expect(result.message).not.toContain("cleanup failed");
	}
});

test("rejects webhook URLs outside the configured allowed origins", async () => {
	let backupRan = false;

	const result = await runWithHooks({
		webhooks: {
			pre: { url: "http://127.0.0.1:9/pre" },
			post: null,
		},
		runBackup: () =>
			Effect.sync(() => {
				backupRan = true;
				return { exitCode: 0, result: null, warningDetails: null };
			}),
	});

	expect(backupRan).toBe(false);
	expect(result).toEqual({
		status: "failed",
		error: "pre webhook URL origin is not allowed. Add http://127.0.0.1:9 to WEBHOOK_ALLOWED_ORIGINS.",
	});
});

test("matches configured webhook origins with trailing slashes or paths", async () => {
	let backupRan = false;

	useWebhookHandlers(
		postWebhook("/pre", ({ response }) => {
			sendWebhookResponse(response);
		}),
	);

	const result = await runWithHooks({
		webhookAllowedOrigins: [`${webhookOrigin}/`, "http://example.com/webhook"],
		webhooks: {
			pre: { url: webhookUrl("/pre") },
			post: null,
		},
		runBackup: () =>
			Effect.sync(() => {
				backupRan = true;
				return { exitCode: 0, result: null, warningDetails: null };
			}),
	});

	expect(backupRan).toBe(true);
	expect(result).toEqual({ status: "completed", exitCode: 0, result: null, warningDetails: null });
});

test("does not follow webhook redirects", async () => {
	let redirectedTargetCalled = false;

	useWebhookHandlers(
		postWebhook("/redirect", ({ response }) => {
			response.writeHead(302, { location: webhookUrl("/target") });
			response.end();
		}),
		postWebhook("/target", ({ response }) => {
			redirectedTargetCalled = true;
			sendWebhookResponse(response);
		}),
	);

	const result = await runWithHooks({
		webhooks: {
			pre: { url: webhookUrl("/redirect") },
			post: null,
		},
		runBackup: () => completedBackup(null),
	});

	expect(redirectedTargetCalled).toBe(false);
	expect(result).toEqual({ status: "failed", error: "pre webhook returned HTTP 302" });
});

test("uses the configured webhook timeout for the request", async () => {
	useWebhookHandlers(
		postWebhook("/pre", ({ response }) => {
			setTimeout(() => {
				if (response.destroyed) return;

				response.writeHead(204);
				response.end();
			}, 300);
		}),
	);

	const result = await runWithHooks({
		webhookTimeoutMs: 50,
		webhooks: {
			pre: { url: webhookUrl("/pre") },
			post: null,
		},
		runBackup: () => completedBackup(null),
	});

	expect(result.status).toBe("failed");
	if (result.status === "failed") {
		expect(result.error).toContain("pre webhook failed: Webhook timed out");
	}
});

test("rejects oversized webhook request bodies and headers", async () => {
	const bodyResult = await runWithHooks({
		webhooks: {
			pre: { url: webhookUrl("/pre"), body: "a".repeat(64 * 1024 + 1) },
			post: null,
		},
		runBackup: () => completedBackup(null),
	});

	expect(bodyResult).toEqual({ status: "failed", error: "Webhook request body exceeds 65536 bytes" });

	const headersResult = await runWithHooks({
		webhooks: {
			pre: { url: webhookUrl("/pre"), headers: [`x-large: ${"a".repeat(8 * 1024)}`] },
			post: null,
		},
		runBackup: () => completedBackup(null),
	});

	expect(headersResult).toEqual({ status: "failed", error: "Webhook request headers exceed 8192 bytes" });
});

test("rejects malformed webhook header lines", () => {
	expect(() => backupWebhookConfigSchema.parse({ url: webhookUrl("/pre"), headers: ["Malformed"] })).toThrow(
		"Headers must use non-empty Key: Value format with valid header names",
	);

	expect(() => backupWebhookConfigSchema.parse({ url: webhookUrl("/pre"), headers: ["Bad Header: value"] })).toThrow(
		"Headers must use non-empty Key: Value format with valid header names",
	);
});

test("cancels before the pre-backup webhook without running the backup", async () => {
	const abortController = new AbortController();
	let backupRan = false;

	abortController.abort(new Error("Backup was cancelled"));

	const result = await runWithHooks({
		webhooks: {
			pre: { url: webhookUrl("/pre") },
			post: { url: webhookUrl("/post") },
		},
		signal: abortController.signal,
		runBackup: () =>
			Effect.sync(() => {
				backupRan = true;
				return { exitCode: 0, result: null, warningDetails: null };
			}),
	});

	expect(backupRan).toBe(false);
	expect(result).toEqual({ status: "cancelled", message: "Backup was cancelled" });
});

test("cancels after the pre-backup webhook without running the backup", async () => {
	const abortController = new AbortController();
	let backupRan = false;

	useWebhookHandlers(
		postWebhook("/pre", ({ response }) => {
			abortController.abort(new Error("Backup was cancelled"));
			sendWebhookResponse(response);
		}),
	);

	const result = await runWithHooks({
		webhooks: {
			pre: { url: webhookUrl("/pre") },
			post: null,
		},
		signal: abortController.signal,
		runBackup: () =>
			Effect.sync(() => {
				backupRan = true;
				return { exitCode: 0, result: null, warningDetails: null };
			}),
	});

	expect(backupRan).toBe(false);
	expect(result).toEqual({ status: "cancelled", message: "Backup was cancelled" });
});
