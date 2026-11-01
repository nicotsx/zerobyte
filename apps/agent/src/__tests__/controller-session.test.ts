import { afterEach, expect, test, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Effect } from "effect";
import { logger } from "@zerobyte/core/node";
import waitForExpect from "wait-for-expect";
import { fromPartial } from "@total-typescript/shoehorn";
import { createControllerMessage, parseAgentMessage } from "@zerobyte/contracts/agent-protocol";
import * as resticServer from "@zerobyte/core/restic/server";
import { createControllerSession } from "../controller-session";
import { createTrustedRootRegistry } from "../trusted-roots";
import { createRunPayload } from "../commands/__tests__/backup-run.harness";

afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
});

test("excludes the saved machine credential from backups without environment configuration", async () => {
	const directory = await fs.mkdtemp(path.join(os.tmpdir(), "zerobyte-agent-credentials-"));
	const configPath = path.join(directory, "agent.json");
	const trustedRoots = createTrustedRootRegistry({
		roots: [{ id: "data", label: "Data", path: directory, allowBackup: true }],
	});
	const restic = vi
		.spyOn(resticServer, "createRestic")
		.mockReturnValue(
			fromPartial({ backup: () => Effect.succeed({ exitCode: 0, result: null, warningDetails: null }) }),
		);
	const session = createControllerSession(fromPartial({ send: vi.fn() }), {
		trustedRoots,
		excludedPaths: [configPath],
	});

	try {
		await fs.writeFile(configPath, JSON.stringify({ token: "machine-credential" }));
		session.onOpen();
		session.onMessage(
			createControllerMessage("backup.run", createRunPayload({ source: { rootId: "data", relativePath: "" } })),
		);

		await waitForExpect(() => {
			expect(restic).toHaveBeenCalledWith(
				expect.objectContaining({ defaultExcludes: expect.arrayContaining([configPath]) }),
			);
		});
	} finally {
		session.close();
		await fs.rm(directory, { recursive: true, force: true });
	}
});

test("emits backup.failed when a backup command hits a restic error", async () => {
	vi.spyOn(resticServer, "createRestic").mockReturnValue(
		fromPartial({
			backup: () => Effect.fail("source path missing"),
		}),
	);

	const outboundMessages: string[] = [];
	const registry = createTrustedRootRegistry({ builtinLocal: true });
	const session = createControllerSession(
		fromPartial({
			send: (message: string) => {
				outboundMessages.push(message);
			},
		}),
		{ trustedRoots: registry, builtinLocal: true },
	);

	try {
		session.onOpen();
		session.onMessage(
			createControllerMessage("backup.run", {
				jobId: "job-1",
				scheduleId: "schedule-1",
				organizationId: "org-1",
				source: { rootId: "local-filesystem", relativePath: "tmp" },
				repositoryConfig: {
					backend: "local",
					path: "/tmp/test-repository",
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
			}),
		);

		await waitForExpect(() => {
			const failedMessage = outboundMessages
				.map((message) => parseAgentMessage(message))
				.find((message) => message?.success && message.data.type === "backup.failed");

			expect(failedMessage?.success).toBe(true);
			if (!failedMessage || !failedMessage.success || failedMessage.data.type !== "backup.failed") {
				return;
			}

			expect(failedMessage.data.payload).toEqual({
				jobId: "job-1",
				scheduleId: "schedule-1",
				error: "Backup failed. Check the agent logs for details.",
				errorDetails: "Backup failed. Check the agent logs for details.",
			});
		});
	} finally {
		session.close();
	}
});

test("closes the websocket when an outbound send throws", async () => {
	const close = vi.fn(() => undefined);
	const session = createControllerSession(
		fromPartial({
			send: () => {
				throw new Error("socket write failed");
			},
			close,
		}),
		{ trustedRoots: createTrustedRootRegistry() },
	);

	try {
		session.onOpen();

		await waitForExpect(() => {
			expect(close).toHaveBeenCalledTimes(1);
		});
	} finally {
		session.close();
	}
});

test("continues processing inbound messages after a filesystem command fails", async () => {
	const trustedRootPath = await fs.mkdtemp(path.join(os.tmpdir(), "zerobyte-agent-root-"));
	const roots = [{ id: "data", label: "Data", path: trustedRootPath, allowBackup: true }];
	const registry = createTrustedRootRegistry({ roots });
	const outboundMessages: string[] = [];
	const session = createControllerSession(
		fromPartial({
			send: (message: string) => {
				outboundMessages.push(message);
			},
		}),
		{ trustedRoots: registry, builtinLocal: false },
	);

	try {
		session.onMessage(
			createControllerMessage("filesystem.command", {
				commandId: "command-1",
				command: {
					name: "filesystem.browse",
					source: { rootId: "data", relativePath: "does-not-exist" },
				},
			}),
		);
		session.onMessage(
			createControllerMessage("filesystem.command", {
				commandId: "command-2",
				command: {
					name: "filesystem.statfs",
					source: { rootId: "data", relativePath: "does-not-exist" },
				},
			}),
		);
		session.onMessage(
			createControllerMessage("filesystem.command", {
				commandId: "command-3",
				command: {
					name: "filesystem.listFiles",
					source: { rootId: "data", relativePath: "does-not-exist" },
					offset: 0,
					limit: 10,
				},
			}),
		);
		session.onMessage(createControllerMessage("heartbeat.ping", { sentAt: 123 }));

		await waitForExpect(() => {
			const parsedMessages = outboundMessages.map((message) => parseAgentMessage(message));
			const volumeResults = parsedMessages.filter(
				(message) => message?.success && message.data.type === "filesystem.commandResult",
			);
			const heartbeatPong = parsedMessages.find(
				(message) => message?.success && message.data.type === "heartbeat.pong",
			);

			expect(volumeResults).toHaveLength(3);

			const volumeResult = volumeResults.find(
				(message) =>
					message?.success &&
					message.data.type === "filesystem.commandResult" &&
					message.data.payload.commandId === "command-1",
			);

			expect(volumeResult?.success).toBe(true);
			if (!volumeResult || !volumeResult.success || volumeResult.data.type !== "filesystem.commandResult") {
				return;
			}

			expect(volumeResult.data.payload).toEqual({
				commandId: "command-1",
				status: "error",
				error: "Trusted source path cannot be resolved",
			});
			expect(JSON.stringify(volumeResult.data.payload)).not.toContain(trustedRootPath);
			expect(JSON.stringify(volumeResults)).not.toContain(trustedRootPath);
			expect(heartbeatPong?.success).toBe(true);
			if (!heartbeatPong || !heartbeatPong.success || heartbeatPong.data.type !== "heartbeat.pong") {
				return;
			}

			expect(heartbeatPong.data.payload).toEqual({ sentAt: 123 });
		});
	} finally {
		session.close();
		await fs.rm(trustedRootPath, { recursive: true, force: true });
	}
});

test("continues processing after standalone restore policy rejection", async () => {
	const registry = createTrustedRootRegistry({ builtinLocal: false });
	const outboundMessages: string[] = [];
	const session = createControllerSession(
		fromPartial({
			send: (message: string) => {
				outboundMessages.push(message);
			},
		}),
		{ trustedRoots: registry, builtinLocal: false },
	);

	try {
		session.onMessage(
			createControllerMessage("restore.run", {
				restoreId: "restore-rejected",
				organizationId: "org-1",
				repositoryId: "repository-1",
				snapshotId: "snapshot-1",
				target: "/private/restore-target",
				repositoryConfig: { backend: "local", path: "/private/repository" },
				runtime: { password: "password" },
				options: { organizationId: "org-1" },
			}),
		);
		session.onMessage(createControllerMessage("heartbeat.ping", { sentAt: 456 }));

		await waitForExpect(() => {
			const parsedMessages = outboundMessages.map((message) => parseAgentMessage(message));
			const restoreFailure = parsedMessages.find(
				(message) => message?.success && message.data.type === "restore.failed",
			);
			const heartbeatPong = parsedMessages.find(
				(message) => message?.success && message.data.type === "heartbeat.pong",
			);
			expect(restoreFailure?.success).toBe(true);
			expect(JSON.stringify(restoreFailure)).not.toContain("/private");
			expect(heartbeatPong?.success).toBe(true);
		});
	} finally {
		session.close();
	}
});

test.each([
	[false, undefined, false],
	[false, false, false],
	[false, true, false],
	[true, false, true],
] as const)(
	"advertises capabilities from its configured roots, builtinLocal=%s, allowBackup=%s",
	async (builtinLocal, allowBackup, allowRestore) => {
		const roots = allowBackup === undefined ? [] : [{ id: "data", label: "Data", path: os.tmpdir(), allowBackup }];
		const trustedRoots = createTrustedRootRegistry({ roots, builtinLocal });
		const messages: string[] = [];
		const session = createControllerSession(fromPartial({ send: (message: string) => messages.push(message) }), {
			trustedRoots,
			builtinLocal,
			resticVersion: "0.18.1",
		});

		try {
			session.onOpen();
			await vi.waitFor(() => expect(messages).toHaveLength(1));
			const ready = parseAgentMessage(messages[0]!);
			if (!ready?.success || ready.data.type !== "agent.ready") throw new Error("Expected agent.ready");

			expect(ready.data.payload.capabilities).toEqual({
				agentVersion: process.env.ZEROBYTE_AGENT_VERSION ?? "dev",
				resticVersion: "0.18.1",
				restore: allowRestore,
				trustedRoots: [...trustedRoots.values()].map((root) => root.descriptor),
			});
			expect(ready.data.payload.capabilities.trustedRoots).toHaveLength(
				Number(builtinLocal) + Number(allowBackup !== undefined),
			);
			expect(JSON.stringify(ready.data.payload.capabilities)).not.toContain(os.tmpdir());
		} finally {
			session.close();
		}
	},
);

test.each([
	["timer stall", 60_000],
	["clock jump", 60_000],
	["clock jump", -60_000],
] as const)("session diagnostics distinguish a %s of %i ms and stop with the session", async (cause, jumpMs) => {
	vi.useFakeTimers({
		toFake: ["Date", "performance", "setTimeout", "clearTimeout", "setInterval", "clearInterval"],
	});
	const startedAt = Date.now();
	const warn = vi.spyOn(logger, "warn").mockImplementation(() => {});
	const info = vi.spyOn(logger, "info").mockImplementation(() => {});

	if (cause === "timer stall") {
		vi.spyOn(performance, "now").mockImplementation(() => Date.now() - startedAt);
	}

	const session = createControllerSession(fromPartial({ send: vi.fn(), bufferedAmount: 17 }), {
		trustedRoots: createTrustedRootRegistry(),
	});

	try {
		session.onMessage(createControllerMessage("heartbeat.ping", { sentAt: 123 }));
		await vi.advanceTimersByTimeAsync(0);

		vi.setSystemTime(Date.now() + jumpMs);
		await vi.advanceTimersByTimeAsync(5_000);

		expect(warn).toHaveBeenCalledWith("Agent session timer delayed or clock changed", expect.any(String));

		const delayed = JSON.parse(String(warn.mock.calls[0]?.[1]));

		expect(delayed).toMatchObject({
			timerDelayMs: cause === "timer stall" ? 60_000 : 0,
			lastClockDriftMs: cause === "clock jump" ? jumpMs : 0,
		});

		session.close();

		expect(info).toHaveBeenCalledWith("Agent session closed", expect.any(String));

		const closed = JSON.parse(String(info.mock.calls[0]?.[1]));

		expect(closed).toMatchObject({
			connectionId: expect.any(String),
			pid: process.pid,
			lastPingToken: 123,
			lastPongToken: 123,
			pingsProcessed: 1,
			pongsSent: 1,
			inboundQueuedMessages: 0,
			outboundQueuedMessages: 0,
			transportBufferedBytes: 17,
			activeJobs: 0,
		});

		await vi.advanceTimersByTimeAsync(30_000);

		expect(warn).toHaveBeenCalledOnce();
		expect(info).toHaveBeenCalledOnce();
	} finally {
		session.close();
	}
});
