import { tmpdir } from "node:os";
import nodeHttp, { type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { Effect } from "effect";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import waitForExpect from "wait-for-expect";
import { fromPartial } from "@total-typescript/shoehorn";
import { parseAgentMessage, type BackupCancelPayload, type BackupRunPayload } from "@zerobyte/contracts/agent-protocol";
import * as resticServer from "@zerobyte/core/restic/server";
import { handleBackupCancelCommand } from "../backup-cancel";
import { handleBackupRunCommand } from "../backup-run";
import type { ControllerCommandContext, RunningJob } from "../../context";
import { createAgentExecutionPolicy } from "../../execution-policy";
import { createTrustedRootRegistry } from "../../trusted-roots";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { ResticError } from "@zerobyte/core/restic/server";

type WebhookHandler = (context: {
	request: IncomingMessage;
	response: ServerResponse;
	body: string;
}) => void | Promise<void>;

let webhookServer: Server;
let webhookOrigin = "";
let webhookHandlers = new Map<string, WebhookHandler>();

const webhookUrl = (path: string) => `${webhookOrigin}${path}`;
const webhookRoute = (path: string, handler: WebhookHandler) => [`POST ${path}`, handler] as const;
const useWebhookHandlers = (...handlers: ReturnType<typeof webhookRoute>[]) => {
	webhookHandlers = new Map(handlers);
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
		const handler = webhookHandlers.get(`${request.method ?? ""} ${pathname}`);

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

const createDeferred = <T>() => {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((resolvePromise) => {
		resolve = resolvePromise;
	});

	return { promise, resolve };
};

afterEach(async () => {
	vi.restoreAllMocks();
	webhookServer.closeAllConnections?.();
	if (webhookServer.listening) {
		await new Promise<void>((resolve, reject) => {
			webhookServer.close((error) => (error ? reject(error) : resolve()));
		});
	}
});

const createRunPayload = (overrides: Partial<BackupRunPayload> = {}) =>
	fromPartial<BackupRunPayload>({
		jobId: "job-1",
		scheduleId: "schedule-1",
		organizationId: "org-1",
		source: {
			kind: "managed",
			volume: {
				id: 1,
				shortId: "volume-1",
				name: "Volume 1",
				config: { backend: "directory", path: "/tmp" },
				createdAt: 0,
				updatedAt: 0,
				lastHealthCheck: 0,
				type: "directory",
				status: "mounted",
				lastError: null,
				autoRemount: true,
				agentId: "local",
				organizationId: "org-1",
			},
		},
		repositoryConfig: {
			backend: "local",
			path: "/tmp/repository",
		},
		options: {
			oneFileSystem: false,
			excludePatterns: null,
			excludeIfPresent: null,
			includePaths: null,
			includePatterns: null,
			customResticParams: null,
			compressionMode: "auto",
		},
		runtime: {
			password: "password",
		},
		webhooks: { pre: null, post: null },
		webhookAllowedOrigins: [webhookOrigin],
		webhookTimeoutMs: 60_000,
		...overrides,
	});

const runBackupCommand = async (
	payload: BackupRunPayload,
	executionPolicy?: ControllerCommandContext["executionPolicy"],
) => {
	const outboundMessages: string[] = [];
	const runningJobs = new Map<string, RunningJob>();
	const builtinRegistry = createTrustedRootRegistry({ builtinLocal: true });
	const builtinPolicy = createAgentExecutionPolicy({ builtinLocal: true, registry: builtinRegistry });
	const selectedExecutionPolicy = executionPolicy ?? builtinPolicy;

	const context: ControllerCommandContext = {
		executionPolicy: selectedExecutionPolicy,
		getRunningJob: (jobId) => Effect.succeed(runningJobs.get(jobId)),
		setRunningJob: (jobId, job) =>
			Effect.sync(() => {
				runningJobs.set(jobId, job);
			}),
		deleteRunningJob: (jobId) =>
			Effect.sync(() => {
				runningJobs.delete(jobId);
			}),
		offerOutbound: (message) =>
			Effect.sync(() => {
				outboundMessages.push(message);
				return true;
			}),
	};

	await Effect.runPromise(
		Effect.gen(function* () {
			yield* handleBackupRunCommand(context, payload);
			yield* Effect.promise(() =>
				waitForExpect(() => {
					expect(runningJobs.has(payload.jobId)).toBe(false);
				}),
			);
		}),
	);

	return outboundMessages.map((message) => parseAgentMessage(message));
};

test("standalone policy rejects legacy and managed backups but permits trusted references", async () => {
	const rootPath = fs.mkdtempSync(path.join(os.tmpdir(), "zerobyte-backup-policy-"));
	const rawRoots = JSON.stringify([{ id: "data", label: "Data", path: rootPath }]);
	const registry = createTrustedRootRegistry({ rawRoots });
	const executionPolicy = createAgentExecutionPolicy({ builtinLocal: false, registry });
	const backup = vi.fn(() => Effect.succeed({ exitCode: 0, result: null, warningDetails: null }));
	vi.spyOn(resticServer, "createRestic").mockReturnValue(fromPartial({ backup }));

	try {
		const legacyMessages = await runBackupCommand(createRunPayload(), executionPolicy);
		const initialSource = createRunPayload().source;
		if (initialSource.kind !== "managed") throw new Error("Expected managed fixture");
		const managedVolume = {
			...initialSource.volume,
			sourceKind: "managed" as const,
			trustedRootId: null,
			relativePath: null,
		};
		const managedPayload = createRunPayload({
			source: { kind: "managed", volume: managedVolume },
		});
		const managedMessages = await runBackupCommand(managedPayload, executionPolicy);
		const trustedPayload = createRunPayload({
			source: {
				kind: "agent-filesystem",
				reference: { rootId: "data", relativePath: "" },
			},
		});
		const trustedMessages = await runBackupCommand(trustedPayload, executionPolicy);

		expect(legacyMessages.some((message) => message?.success && message.data.type === "backup.failed")).toBe(true);
		expect(managedMessages.some((message) => message?.success && message.data.type === "backup.failed")).toBe(true);
		expect(trustedMessages.some((message) => message?.success && message.data.type === "backup.completed")).toBe(
			true,
		);
		expect(backup).toHaveBeenCalledOnce();
	} finally {
		fs.rmSync(rootPath, { recursive: true, force: true });
	}
});

test("trusted backup resolution errors do not disclose the configured host root", async () => {
	const rootPath = fs.mkdtempSync(path.join(os.tmpdir(), "zerobyte-backup-errors-"));
	const rawRoots = JSON.stringify([{ id: "data", label: "Data", path: rootPath }]);
	const registry = createTrustedRootRegistry({ rawRoots });
	const executionPolicy = createAgentExecutionPolicy({ builtinLocal: false, registry });
	const payload = createRunPayload({
		source: {
			kind: "agent-filesystem",
			reference: { rootId: "data", relativePath: "missing" },
		},
	});

	try {
		const messages = await runBackupCommand(payload, executionPolicy);
		const failed = messages.find((message) => message?.success && message.data.type === "backup.failed");
		expect(failed?.success).toBe(true);
		expect(JSON.stringify(failed)).not.toContain(rootPath);
	} finally {
		fs.rmSync(rootPath, { recursive: true, force: true });
	}
});

test("trusted backup presents only logical paths in progress, warnings, and pre/post webhooks", async () => {
	const rootPath = fs.mkdtempSync(path.join(os.tmpdir(), "zerobyte backup,presentation-"));
	const sourcePath = path.join(rootPath, "configured source,archive");
	fs.mkdirSync(sourcePath, { recursive: true });
	const expectedCanonicalSourcePath = fs.realpathSync.native(sourcePath);
	const rawRoots = JSON.stringify([{ id: "data", label: "Data", path: rootPath }]);
	const registry = createTrustedRootRegistry({ rawRoots });
	const executionPolicy = createAgentExecutionPolicy({ builtinLocal: false, registry });
	const webhookBodies: string[] = [];
	useWebhookHandlers(
		webhookRoute("/pre", ({ body, response }) => {
			webhookBodies.push(body);
			sendWebhookResponse(response);
		}),
		webhookRoute("/post", ({ body, response }) => {
			webhookBodies.push(body);
			sendWebhookResponse(response);
		}),
	);
	vi.spyOn(resticServer, "createRestic").mockReturnValue(
		fromPartial({
			backup: (
				_config: unknown,
				actualSourcePath: string,
				options: { onProgress?: (progress: unknown) => void },
			) =>
				Effect.sync(() => {
					expect(actualSourcePath).toBe(expectedCanonicalSourcePath);
					options.onProgress?.({
						message_type: "status",
						seconds_elapsed: 1,
						seconds_remaining: 1,
						percent_done: 0.5,
						total_files: 1,
						files_done: 0,
						total_bytes: 1,
						bytes_done: 0,
						current_files: [path.join(sourcePath, "dir with spaces", "file,one.txt")],
					});
					return {
						exitCode: 3,
						result: null,
						warningDetails: `error: open ${path.join(sourcePath, "private,file.db")}: permission denied`,
					};
				}),
		}),
	);
	const payload = createRunPayload({
		source: {
			kind: "agent-filesystem",
			reference: { rootId: "data", relativePath: "configured source,archive" },
		},
		webhooks: {
			pre: { url: webhookUrl("/pre") },
			post: { url: webhookUrl("/post") },
		},
	});

	try {
		const messages = await runBackupCommand(payload, executionPolicy);
		const serializedMessages = JSON.stringify(messages);
		const serializedWebhooks = webhookBodies.join("\n");
		const parsedWebhooks = webhookBodies.map((body) => JSON.parse(body));
		expect(serializedMessages).not.toContain(rootPath);
		expect(serializedWebhooks).not.toContain(rootPath);
		expect(serializedMessages).toContain("/configured source,archive/dir with spaces/file,one.txt");
		expect(serializedMessages).toContain("Check the agent logs");
		expect(parsedWebhooks.map((body) => body.sourcePath)).toEqual([
			"/configured source,archive",
			"/configured source,archive",
		]);
		expect(parsedWebhooks[1]?.error).toContain("Check the agent logs");
	} finally {
		fs.rmSync(rootPath, { recursive: true, force: true });
	}
});

test("explicit filesystem root uses synthetic paths in progress, warnings, and webhooks", async () => {
	const sourcePath = fs.mkdtempSync(path.join(os.tmpdir(), "zerobyte-root-presentation-"));
	const canonicalSourcePath = fs.realpathSync.native(sourcePath);
	const relativeSourcePath = canonicalSourcePath.replace(/^\/+/, "");
	const rawRoots = JSON.stringify([{ id: "filesystem", label: "Filesystem", path: "/" }]);
	const registry = createTrustedRootRegistry({ rawRoots });
	const executionPolicy = createAgentExecutionPolicy({ builtinLocal: false, registry });
	const webhookBodies: string[] = [];
	useWebhookHandlers(
		webhookRoute("/pre", ({ body, response }) => {
			webhookBodies.push(body);
			sendWebhookResponse(response);
		}),
		webhookRoute("/post", ({ body, response }) => {
			webhookBodies.push(body);
			sendWebhookResponse(response);
		}),
	);
	vi.spyOn(resticServer, "createRestic").mockReturnValue(
		fromPartial({
			backup: (
				_config: unknown,
				actualSourcePath: string,
				options: { onProgress?: (progress: unknown) => void },
			) =>
				Effect.sync(() => {
					expect(actualSourcePath).toBe(canonicalSourcePath);
					options.onProgress?.({
						message_type: "status",
						seconds_elapsed: 1,
						seconds_remaining: 1,
						percent_done: 0.5,
						total_files: 1,
						files_done: 0,
						total_bytes: 1,
						bytes_done: 0,
						current_files: [path.join(canonicalSourcePath, "private.txt")],
					});
					return {
						exitCode: 3,
						result: null,
						warningDetails: `failed to read ${path.join(canonicalSourcePath, "private.txt")}`,
					};
				}),
		}),
	);
	const payload = createRunPayload({
		source: {
			kind: "agent-filesystem",
			reference: { rootId: "filesystem", relativePath: relativeSourcePath },
		},
		webhooks: {
			pre: { url: webhookUrl("/pre") },
			post: { url: webhookUrl("/post") },
		},
	});

	try {
		const messages = await runBackupCommand(payload, executionPolicy);
		const serializedOutput = `${JSON.stringify(messages)}\n${webhookBodies.join("\n")}`;

		expect(serializedOutput).not.toContain(canonicalSourcePath);
		expect(serializedOutput).toContain(`trusted-root:${relativeSourcePath}`);
		expect(serializedOutput).toContain(`trusted-root:${relativeSourcePath}/private.txt`);
	} finally {
		fs.rmSync(sourcePath, { recursive: true, force: true });
	}
});

test("trusted backup redacts fatal Restic and lifecycle catch details", async () => {
	const rootPath = fs.mkdtempSync(path.join(os.tmpdir(), "zerobyte-backup-fatal-"));
	const rawRoots = JSON.stringify([{ id: "data", label: "Data", path: rootPath }]);
	const registry = createTrustedRootRegistry({ rawRoots });
	const executionPolicy = createAgentExecutionPolicy({ builtinLocal: false, registry });
	const failures = [
		new ResticError(12, `fatal read of ${path.join(rootPath, "secret.txt")}`),
		new Error(`unexpected failure below ${path.join(rootPath, "nested", "secret.txt")}`),
	];

	try {
		for (const failure of failures) {
			vi.spyOn(resticServer, "createRestic").mockReturnValueOnce(
				fromPartial({ backup: () => Effect.fail(failure) }),
			);
			const payload = createRunPayload({
				jobId: `job-${failures.indexOf(failure)}`,
				source: { kind: "agent-filesystem", reference: { rootId: "data", relativePath: "" } },
			});
			const messages = await runBackupCommand(payload, executionPolicy);
			const serializedMessages = JSON.stringify(messages);
			expect(serializedMessages).not.toContain(rootPath);
			expect(serializedMessages.toLocaleLowerCase()).not.toContain(rootPath.toLocaleLowerCase());
			expect(messages.some((message) => message?.success && message.data.type === "backup.failed")).toBe(true);
		}
	} finally {
		fs.rmSync(rootPath, { recursive: true, force: true });
	}
});

test("trusted backup redacts errors thrown after source resolution", async () => {
	const rootPath = fs.mkdtempSync(path.join(os.tmpdir(), "zerobyte-backup-catch-"));
	const rawRoots = JSON.stringify([{ id: "data", label: "Data", path: rootPath }]);
	const registry = createTrustedRootRegistry({ rawRoots });
	const executionPolicy = createAgentExecutionPolicy({ builtinLocal: false, registry });
	vi.spyOn(resticServer, "createRestic").mockImplementationOnce(() => {
		throw new Error(`failed to initialize for ${path.join(rootPath, "secret.txt")}`);
	});
	const payload = createRunPayload({
		source: { kind: "agent-filesystem", reference: { rootId: "data", relativePath: "" } },
	});

	try {
		const messages = await runBackupCommand(payload, executionPolicy);
		const serializedMessages = JSON.stringify(messages);
		expect(serializedMessages).not.toContain(rootPath);
		expect(serializedMessages).toContain("Check the agent logs");
		expect(messages.some((message) => message?.success && message.data.type === "backup.failed")).toBe(true);
	} finally {
		fs.rmSync(rootPath, { recursive: true, force: true });
	}
});

test("runs pre and post backup webhooks around restic", async () => {
	const events: string[] = [];

	useWebhookHandlers(
		webhookRoute("/pre", ({ body, response }) => {
			events.push((JSON.parse(body) as { event: string }).event);
			sendWebhookResponse(response);
		}),
		webhookRoute("/post", ({ body, response }) => {
			events.push((JSON.parse(body) as { event: string }).event);
			sendWebhookResponse(response);
		}),
	);

	vi.spyOn(resticServer, "createRestic").mockReturnValue(
		fromPartial({
			backup: () =>
				Effect.sync(() => {
					events.push("restic");
					return { exitCode: 0, result: null, warningDetails: null };
				}),
		}),
	);

	const messages = await runBackupCommand(
		createRunPayload({
			webhooks: {
				pre: { url: webhookUrl("/pre") },
				post: { url: webhookUrl("/post") },
			},
		}),
	);

	expect(events).toEqual(["backup.pre", "restic", "backup.post"]);
	expect(messages.some((message) => message?.success && message.data.type === "backup.completed")).toBe(true);
});

test("sends configured webhook headers and body without changing them", async () => {
	const requests: Array<{ url: string; headers: Headers; body: string }> = [];

	useWebhookHandlers(
		webhookRoute("/pre", ({ request, response, body }) => {
			requests.push({
				url: webhookUrl("/pre"),
				headers: new Headers(request.headers as Record<string, string>),
				body,
			});
			sendWebhookResponse(response);
		}),
		webhookRoute("/post", ({ request, response, body }) => {
			requests.push({
				url: webhookUrl("/post"),
				headers: new Headers(request.headers as Record<string, string>),
				body,
			});
			sendWebhookResponse(response);
		}),
	);

	vi.spyOn(resticServer, "createRestic").mockReturnValue(
		fromPartial({
			backup: () => Effect.succeed({ exitCode: 0, result: null, warningDetails: null }),
		}),
	);

	await runBackupCommand(
		createRunPayload({
			webhooks: {
				pre: {
					url: webhookUrl("/pre"),
					headers: ["authorization: Bearer pre-token", "content-type: application/json"],
					body: '{"action":"stop"}',
				},
				post: {
					url: webhookUrl("/post"),
					headers: ["authorization: Bearer post-token"],
					body: "start-container",
				},
			},
		}),
	);

	expect(requests).toHaveLength(2);
	expect(requests[0]?.url).toBe(webhookUrl("/pre"));
	expect(requests[0]?.headers.get("authorization")).toBe("Bearer pre-token");
	expect(requests[0]?.headers.get("content-type")).toBe("application/json");
	expect(requests[0]?.body).toBe('{"action":"stop"}');
	expect(requests[1]?.url).toBe(webhookUrl("/post"));
	expect(requests[1]?.headers.get("authorization")).toBe("Bearer post-token");
	expect(requests[1]?.body).toBe("start-container");
});

test("fails without running restic when the pre-backup webhook fails", async () => {
	const backupMock = vi.fn();
	useWebhookHandlers(
		webhookRoute("/pre", ({ response }) => {
			sendWebhookResponse(response, 500, "stop failed");
		}),
	);
	vi.spyOn(resticServer, "createRestic").mockReturnValue(
		fromPartial({
			backup: backupMock,
		}),
	);

	const messages = await runBackupCommand(
		createRunPayload({
			webhooks: {
				pre: { url: webhookUrl("/pre") },
				post: null,
			},
		}),
	);

	const failed = messages.find((message) => message?.success && message.data.type === "backup.failed");
	expect(backupMock).not.toHaveBeenCalled();
	expect(failed?.success).toBe(true);
	if (failed?.success && failed.data.type === "backup.failed") {
		expect(failed.data.payload.errorDetails).toContain("pre webhook returned HTTP 500");
	}
});

test("reports a post-backup webhook failure as completed warning details", async () => {
	useWebhookHandlers(
		webhookRoute("/post", ({ response }) => {
			sendWebhookResponse(response, 500, "start failed");
		}),
	);
	vi.spyOn(resticServer, "createRestic").mockReturnValue(
		fromPartial({
			backup: () => Effect.succeed({ exitCode: 0, result: null, warningDetails: null }),
		}),
	);

	const messages = await runBackupCommand(
		createRunPayload({
			webhooks: {
				pre: null,
				post: { url: webhookUrl("/post") },
			},
		}),
	);

	const completed = messages.find((message) => message?.success && message.data.type === "backup.completed");
	expect(completed?.success).toBe(true);
	if (completed?.success && completed.data.type === "backup.completed") {
		expect(completed.data.payload.warningDetails).toContain("post webhook returned HTTP 500");
	}
});

test("includes post-backup webhook failure details when a backup is cancelled", async () => {
	useWebhookHandlers(
		webhookRoute("/post", ({ response }) => {
			sendWebhookResponse(response, 500, "start failed");
		}),
	);
	vi.spyOn(resticServer, "createRestic").mockReturnValue(
		fromPartial({
			backup: (_config: unknown, _source: string, options: { signal: AbortSignal }) =>
				Effect.sync(() => {
					vi.spyOn(options.signal, "aborted", "get").mockReturnValue(true);
					vi.spyOn(options.signal, "reason", "get").mockReturnValue(new Error("Backup was cancelled"));
					return { exitCode: 0, result: null, warningDetails: null };
				}),
		}),
	);

	const messages = await runBackupCommand(
		createRunPayload({
			webhooks: {
				pre: null,
				post: { url: webhookUrl("/post") },
			},
		}),
	);

	const cancelled = messages.find((message) => message?.success && message.data.type === "backup.cancelled");
	expect(cancelled?.success).toBe(true);
	if (cancelled?.success && cancelled.data.type === "backup.cancelled") {
		expect(cancelled.data.payload.message).toContain("post webhook returned HTTP 500");
		expect(cancelled.data.payload.message).not.toContain("start failed");
	}
});

test("waits for running-job registration before returning to the processor loop", async () => {
	const outboundMessages: string[] = [];
	const runningJobs = new Map<string, RunningJob>();
	const setRunningJobGate = createDeferred<void>();
	const processorLoopGate = createDeferred<void>();
	const commandCompleted = createDeferred<void>();
	const backupGate = createDeferred<{ exitCode: number; result: null; warningDetails: null }>();
	let registeredAbortController: AbortController | undefined;

	vi.spyOn(resticServer, "createRestic").mockReturnValue(
		fromPartial({
			backup: () =>
				Effect.async<{ exitCode: number; result: null; warningDetails: null }, never>((resume) => {
					void backupGate.promise.then((result) => {
						resume(Effect.succeed(result));
					});
				}),
		}),
	);

	const context: ControllerCommandContext = {
		executionPolicy: createAgentExecutionPolicy({
			builtinLocal: true,
			registry: createTrustedRootRegistry({ builtinLocal: true }),
		}),
		getRunningJob: (jobId) => Effect.succeed(runningJobs.get(jobId)),
		setRunningJob: (jobId, job) =>
			Effect.async<void, never>((resume) => {
				void setRunningJobGate.promise.then(() => {
					runningJobs.set(jobId, job);
					registeredAbortController = job.abortController;
					resume(Effect.void);
				});
			}),
		deleteRunningJob: (jobId) =>
			Effect.sync(() => {
				runningJobs.delete(jobId);
			}),
		offerOutbound: (message) =>
			Effect.sync(() => {
				outboundMessages.push(message);
				return true;
			}),
	};

	const runPayload = fromPartial<BackupRunPayload>({
		jobId: "job-1",
		scheduleId: "schedule-1",
		organizationId: "org-1",
		source: {
			kind: "managed",
			volume: {
				id: 1,
				shortId: "volume-1",
				name: "Volume 1",
				config: { backend: "directory", path: "/tmp" },
				createdAt: 0,
				updatedAt: 0,
				lastHealthCheck: 0,
				type: "directory",
				status: "mounted",
				lastError: null,
				autoRemount: true,
				agentId: "local",
				organizationId: "org-1",
			},
		},
		repositoryConfig: {
			backend: "local",
			path: "/tmp/repository",
		},
		options: {
			oneFileSystem: false,
			excludePatterns: null,
			excludeIfPresent: null,
			includePaths: null,
			includePatterns: null,
			customResticParams: null,
			compressionMode: "auto",
		},
		runtime: {
			password: "password",
		},
		webhooks: { pre: null, post: null },
		webhookAllowedOrigins: [],
		webhookTimeoutMs: 60_000,
	});
	const cancelPayload = fromPartial<BackupCancelPayload>({
		jobId: "job-1",
		scheduleId: "schedule-1",
	});

	const processorLoopPromise = Effect.runPromise(
		Effect.gen(function* () {
			yield* handleBackupRunCommand(context, runPayload);
			commandCompleted.resolve(undefined);
			yield* Effect.async<void, never>((resume) => {
				void processorLoopGate.promise.then(() => {
					resume(Effect.void);
				});
			});
		}),
	);

	try {
		const returnedBeforeRegistration = await Promise.race([
			commandCompleted.promise.then(() => true),
			new Promise<false>((resolve) => {
				setTimeout(() => resolve(false), 0);
			}),
		]);

		expect(returnedBeforeRegistration).toBe(false);

		setRunningJobGate.resolve(undefined);
		await commandCompleted.promise;

		await Effect.runPromise(handleBackupCancelCommand(context, cancelPayload));
		expect(registeredAbortController?.signal.aborted).toBe(true);

		backupGate.resolve({ exitCode: 0, result: null, warningDetails: null });

		await waitForExpect(() => {
			const cancelledMessage = outboundMessages
				.map((message) => parseAgentMessage(message))
				.find((message) => message?.success && message.data.type === "backup.cancelled");

			expect(cancelledMessage?.success).toBe(true);
			expect(runningJobs.has("job-1")).toBe(false);
		});
	} finally {
		processorLoopGate.resolve(undefined);
		setRunningJobGate.resolve(undefined);
		backupGate.resolve({ exitCode: 0, result: null, warningDetails: null });
		await processorLoopPromise;
	}
});

test.each(["unmounted", "error"] as const)(
	"backs up an accessible directory with saved %s status and auto-remount disabled",
	async (status) => {
		vi.spyOn(resticServer, "createRestic").mockReturnValue(
			fromPartial({
				backup: () => Effect.succeed({ exitCode: 0, result: null, warningDetails: null }),
			}),
		);
		const payload = createRunPayload();
		if (payload.source.kind !== "managed") {
			throw new Error("Expected managed backup source");
		}
		payload.source.volume = {
			...payload.source.volume,
			status,
			autoRemount: false,
			config: { backend: "directory", path: tmpdir() },
		};
		const messages = await runBackupCommand(payload);
		expect(messages.some((message) => message?.success && message.data.type === "backup.completed")).toBe(true);
		expect(messages.some((message) => message?.success && message.data.type === "backup.failed")).toBe(false);
	},
);
