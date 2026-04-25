import { Effect } from "effect";
import { HttpResponse, http } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, expect, test } from "vitest";
import { runBackupWithWebhooks } from "../index.js";

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

	const result = await Effect.runPromise(
		runBackupWithWebhooks({
			metadata,
			webhooks: {
				pre: { url: "http://localhost:8080/pre" },
				post: { url: "http://localhost:8080/post" },
			},
			signal: new AbortController().signal,
			runBackup: () =>
				Effect.sync(() => {
					events.push("backup");
					return { status: "completed" as const, exitCode: 0, result: "snapshot-1", warningDetails: null };
				}),
		}),
	);

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

	const result = await Effect.runPromise(
		runBackupWithWebhooks({
			metadata,
			webhooks: {
				pre: null,
				post: { url: "http://localhost:8080/post" },
			},
			signal: new AbortController().signal,
			runBackup: () =>
				Effect.succeed({
					status: "completed" as const,
					exitCode: 3,
					result: "snapshot-1",
					warningDetails: "some files could not be read",
				}),
		}),
	);

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

	const result = await Effect.runPromise(
		runBackupWithWebhooks({
			metadata,
			webhooks: {
				pre: null,
				post: { url: "http://localhost:8080/post" },
			},
			signal: new AbortController().signal,
			runBackup: () => Effect.succeed({ status: "failed" as const, error: new Error("restic failed") }),
		}),
	);

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

	const result = await Effect.runPromise(
		runBackupWithWebhooks({
			metadata,
			webhooks: {
				pre: { url: "http://localhost:8080/pre" },
				post: { url: "http://localhost:8080/post" },
			},
			signal: new AbortController().signal,
			runBackup: () =>
				Effect.sync(() => {
					backupRan = true;
					return { status: "completed" as const, exitCode: 0, result: null, warningDetails: null };
				}),
		}),
	);

	expect(backupRan).toBe(false);
	expect(postRan).toBe(false);
	expect(result.status).toBe("failed");
	if (result.status === "failed") {
		expect(result.error).toContain("Pre-backup webhook returned HTTP 500: stop failed");
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

	await Effect.runPromise(
		runBackupWithWebhooks({
			metadata,
			webhooks: {
				pre: null,
				post: {
					url: "http://localhost:8080/post",
					headers: ["authorization: Bearer post-token"],
					body: "start-container",
				},
			},
			signal: new AbortController().signal,
			runBackup: () =>
				Effect.succeed({ status: "completed" as const, exitCode: 0, result: null, warningDetails: null }),
		}),
	);

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

	const result = await Effect.runPromise(
		runBackupWithWebhooks({
			metadata,
			webhooks: {
				pre: null,
				post: { url: "http://localhost:8080/post" },
			},
			signal: abortController.signal,
			runBackup: () =>
				Effect.sync(() => {
					abortController.abort(new Error("Backup was cancelled"));
					return { status: "failed" as const, error: new Error("restic cancelled") };
				}),
		}),
	);

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

	const result = await Effect.runPromise(
		runBackupWithWebhooks({
			metadata,
			webhooks: {
				pre: null,
				post: { url: "http://localhost:8080/post" },
			},
			signal: abortController.signal,
			runBackup: () =>
				Effect.sync(() => {
					abortController.abort(new Error("Backup was cancelled"));
					return { status: "completed" as const, exitCode: 0, result: null, warningDetails: null };
				}),
		}),
	);

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

	const result = await Effect.runPromise(
		runBackupWithWebhooks({
			metadata,
			webhooks: {
				pre: null,
				post: { url: "http://localhost:8080/post" },
			},
			signal: abortController.signal,
			runBackup: () =>
				Effect.sync(() => {
					abortController.abort(new Error("Backup was cancelled"));
					return { status: "failed" as const, error: new Error("restic cancelled") };
				}),
		}),
	);

	expect(postBody).toMatchObject({ status: "cancelled", error: "restic cancelled" });
	expect(result.status).toBe("cancelled");
	if (result.status === "cancelled") {
		expect(result.message).toContain("Backup was cancelled");
		expect(result.message).toContain("Post-backup webhook returned HTTP 500: start failed");
	}
});

test("cancels before the pre-backup webhook without running the backup", async () => {
	const abortController = new AbortController();
	let backupRan = false;

	abortController.abort(new Error("Backup was cancelled"));

	const result = await Effect.runPromise(
		runBackupWithWebhooks({
			metadata,
			webhooks: {
				pre: { url: "http://localhost:8080/pre" },
				post: { url: "http://localhost:8080/post" },
			},
			signal: abortController.signal,
			runBackup: () =>
				Effect.sync(() => {
					backupRan = true;
					return { status: "completed" as const, exitCode: 0, result: null, warningDetails: null };
				}),
		}),
	);

	expect(backupRan).toBe(false);
	expect(result).toEqual({ status: "cancelled", message: "Backup was cancelled" });
});
