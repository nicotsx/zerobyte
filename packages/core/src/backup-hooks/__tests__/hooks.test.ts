import { Effect } from "effect";
import { HttpResponse, http } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, expect, test } from "vitest";
import { runBackupLifecycle } from "../index.js";

const server = setupServer();

beforeAll(() => {
	server.listen({ onUnhandledRequest: "error" });
});

afterEach(() => {
	server.resetHandlers();
});

afterAll(() => {
	server.close();
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
			webhookAllowedOrigins: ["http://localhost:8080"],
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

	server.use(
		http.post("http://localhost:8080/pre", async ({ request }) => {
			events.push("pre");
			preBody = (await request.json()) as WebhookBody;
			return new HttpResponse(null, { status: 204 });
		}),
		http.post("http://localhost:8080/post", async ({ request }) => {
			events.push("post");
			postBody = (await request.json()) as WebhookBody;
			return new HttpResponse(null, { status: 204 });
		}),
	);

	const result = await runWithHooks({
		webhooks: {
			pre: { url: "http://localhost:8080/pre" },
			post: { url: "http://localhost:8080/post" },
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

	server.use(
		http.post("http://localhost:8080/post", async ({ request }) => {
			postBody = (await request.json()) as WebhookBody;
			return new HttpResponse(null, { status: 204 });
		}),
	);

	const result = await runWithHooks({
		webhooks: {
			pre: null,
			post: { url: "http://localhost:8080/post" },
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

test("sends error details to the post-backup webhook when the backup fails", async () => {
	let postBody: WebhookBody | undefined;

	server.use(
		http.post("http://localhost:8080/post", async ({ request }) => {
			postBody = (await request.json()) as WebhookBody;
			return new HttpResponse(null, { status: 204 });
		}),
	);

	const result = await runWithHooks({
		webhooks: {
			pre: null,
			post: { url: "http://localhost:8080/post" },
		},
		runBackup: () => Effect.fail(new Error("restic failed")),
	});

	expect(postBody).toMatchObject({ status: "error", error: "restic failed" });
	expect(result).toEqual({ status: "failed", error: "restic failed" });
});

test("fails without running the backup or post webhook when the pre-backup webhook fails", async () => {
	let backupRan = false;
	let postRan = false;

	server.use(
		http.post("http://localhost:8080/pre", () => {
			return new HttpResponse("stop failed", { status: 500 });
		}),
		http.post("http://localhost:8080/post", () => {
			postRan = true;
			return new HttpResponse(null, { status: 204 });
		}),
	);

	const result = await runWithHooks({
		webhooks: {
			pre: { url: "http://localhost:8080/pre" },
			post: { url: "http://localhost:8080/post" },
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

	server.use(
		http.post("http://localhost:8080/post", async ({ request }) => {
			body = await request.text();
			authorization = request.headers.get("authorization");
			contentType = request.headers.get("content-type");
			return new HttpResponse(null, { status: 204 });
		}),
	);

	await runWithHooks({
		webhooks: {
			pre: null,
			post: {
				url: "http://localhost:8080/post",
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

	server.use(
		http.post("http://localhost:8080/post", async ({ request }) => {
			postBody = (await request.json()) as { status?: string; error?: string };
			return new HttpResponse(null, { status: 204 });
		}),
	);

	const result = await runWithHooks({
		webhooks: {
			pre: null,
			post: { url: "http://localhost:8080/post" },
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

	server.use(
		http.post("http://localhost:8080/post", async ({ request }) => {
			postBody = (await request.json()) as { status?: string; error?: string };
			return new HttpResponse(null, { status: 204 });
		}),
	);

	const result = await runWithHooks({
		webhooks: {
			pre: null,
			post: { url: "http://localhost:8080/post" },
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

	server.use(
		http.post("http://localhost:8080/post", async ({ request }) => {
			postBody = (await request.json()) as { status?: string; error?: string };
			return new HttpResponse("start failed", { status: 500 });
		}),
	);

	const result = await runWithHooks({
		webhooks: {
			pre: null,
			post: { url: "http://localhost:8080/post" },
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

	server.use(
		http.post("http://localhost:8080/post", async ({ request }) => {
			postBody = (await request.json()) as { status?: string; error?: string };
			return new HttpResponse("cleanup failed", { status: 500 });
		}),
	);

	const result = await runWithHooks({
		webhooks: {
			pre: null,
			post: { url: "http://localhost:8080/post" },
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
			pre: { url: "http://127.0.0.1:8080/pre" },
			post: null,
		},
		runBackup: () =>
			Effect.sync(() => {
				backupRan = true;
				return { exitCode: 0, result: null, warningDetails: null };
			}),
	});

	expect(backupRan).toBe(false);
	expect(result).toEqual({ status: "failed", error: "pre webhook URL origin is not allowed" });
});

test("does not follow webhook redirects", async () => {
	let redirectedTargetCalled = false;

	server.use(
		http.post("http://localhost:8080/redirect", () => {
			return new HttpResponse(null, { status: 302, headers: { location: "http://localhost:8080/target" } });
		}),
		http.post("http://localhost:8080/target", () => {
			redirectedTargetCalled = true;
			return new HttpResponse(null, { status: 204 });
		}),
	);

	const result = await runWithHooks({
		webhooks: {
			pre: { url: "http://localhost:8080/redirect" },
			post: null,
		},
		runBackup: () => completedBackup(null),
	});

	expect(redirectedTargetCalled).toBe(false);
	expect(result).toEqual({ status: "failed", error: "pre webhook returned HTTP 302" });
});

test("rejects oversized webhook request bodies and headers", async () => {
	const bodyResult = await runWithHooks({
		webhooks: {
			pre: { url: "http://localhost:8080/pre", body: "a".repeat(64 * 1024 + 1) },
			post: null,
		},
		runBackup: () => completedBackup(null),
	});

	expect(bodyResult).toEqual({ status: "failed", error: "Webhook request body exceeds 65536 bytes" });

	const headersResult = await runWithHooks({
		webhooks: {
			pre: { url: "http://localhost:8080/pre", headers: [`x-large: ${"a".repeat(8 * 1024)}`] },
			post: null,
		},
		runBackup: () => completedBackup(null),
	});

	expect(headersResult).toEqual({ status: "failed", error: "Webhook request headers exceed 8192 bytes" });
});

test("cancels before the pre-backup webhook without running the backup", async () => {
	const abortController = new AbortController();
	let backupRan = false;

	abortController.abort(new Error("Backup was cancelled"));

	const result = await runWithHooks({
		webhooks: {
			pre: { url: "http://localhost:8080/pre" },
			post: { url: "http://localhost:8080/post" },
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

	server.use(
		http.post("http://localhost:8080/pre", () => {
			abortController.abort(new Error("Backup was cancelled"));
			return new HttpResponse(null, { status: 204 });
		}),
	);

	const result = await runWithHooks({
		webhooks: {
			pre: { url: "http://localhost:8080/pre" },
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
