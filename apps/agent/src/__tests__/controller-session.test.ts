import { afterEach, expect, test, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Effect } from "effect";
import waitForExpect from "wait-for-expect";
import { fromPartial } from "@total-typescript/shoehorn";
import { createControllerMessage, parseAgentMessage } from "@zerobyte/contracts/agent-protocol";
import * as resticServer from "@zerobyte/core/restic/server";
import { createControllerSession } from "../controller-session";
import { createAgentExecutionPolicy } from "../execution-policy";
import { createTrustedRootRegistry } from "../trusted-roots";

afterEach(() => {
	vi.restoreAllMocks();
});

test("emits backup.failed when a backup command hits a restic error", async () => {
	vi.spyOn(resticServer, "createRestic").mockReturnValue(
		fromPartial({
			backup: () => Effect.fail("source path missing"),
		}),
	);

	const outboundMessages: string[] = [];
	const registry = createTrustedRootRegistry({ builtinLocal: true });
	const executionPolicy = createAgentExecutionPolicy({ builtinLocal: true, registry });
	const session = createControllerSession(
		fromPartial({
			send: (message: string) => {
				outboundMessages.push(message);
			},
		}),
		{ executionPolicy },
	);

	try {
		session.onOpen();
		session.onMessage(
			createControllerMessage("backup.run", {
				jobId: "job-1",
				scheduleId: "schedule-1",
				organizationId: "org-1",
				source: {
					kind: "managed",
					volume: {
						sourceKind: "managed",
						trustedRootId: null,
						relativePath: null,
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
				error: "source path missing",
				errorDetails: "source path missing",
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

test("continues processing inbound messages after a volume command fails", async () => {
	const trustedRootPath = await fs.mkdtemp(path.join(os.tmpdir(), "zerobyte-agent-root-"));
	const rawRoots = JSON.stringify([{ id: "data", label: "Data", path: trustedRootPath }]);
	const registry = createTrustedRootRegistry({ rawRoots });
	const executionPolicy = createAgentExecutionPolicy({ builtinLocal: false, registry });
	const outboundMessages: string[] = [];
	const session = createControllerSession(
		fromPartial({
			send: (message: string) => {
				outboundMessages.push(message);
			},
		}),
		{ executionPolicy },
	);

	try {
		session.onMessage(
			createControllerMessage("volume.command", {
				commandId: "command-1",
				command: {
					name: "filesystem.browse",
					reference: { rootId: "data", relativePath: "does-not-exist" },
				},
			}),
		);
		session.onMessage(
			createControllerMessage("volume.command", {
				commandId: "command-2",
				command: {
					name: "volume.statfs",
					source: {
						kind: "agent-filesystem",
						reference: { rootId: "data", relativePath: "does-not-exist" },
					},
				},
			}),
		);
		session.onMessage(
			createControllerMessage("volume.command", {
				commandId: "command-3",
				command: {
					name: "volume.listFiles",
					source: {
						kind: "agent-filesystem",
						reference: { rootId: "data", relativePath: "does-not-exist" },
					},
					offset: 0,
					limit: 10,
				},
			}),
		);
		session.onMessage(createControllerMessage("heartbeat.ping", { sentAt: 123 }));

		await waitForExpect(() => {
			const parsedMessages = outboundMessages.map((message) => parseAgentMessage(message));
			const volumeResults = parsedMessages.filter(
				(message) => message?.success && message.data.type === "volume.commandResult",
			);
			const heartbeatPong = parsedMessages.find(
				(message) => message?.success && message.data.type === "heartbeat.pong",
			);

			expect(volumeResults).toHaveLength(3);
			const volumeResult = volumeResults[0];
			expect(volumeResult?.success).toBe(true);
			if (!volumeResult || !volumeResult.success || volumeResult.data.type !== "volume.commandResult") {
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
	const executionPolicy = createAgentExecutionPolicy({ builtinLocal: false, registry });
	const outboundMessages: string[] = [];
	const session = createControllerSession(
		fromPartial({
			send: (message: string) => {
				outboundMessages.push(message);
			},
		}),
		{ executionPolicy },
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

test("preserves the existing-install built-in local filesystem workflow", async () => {
	const browseRoot = await fs.mkdtemp(path.join(os.tmpdir(), "zerobyte-agent-browse-"));
	await fs.mkdir(path.join(browseRoot, "backups"));
	await fs.writeFile(path.join(browseRoot, "ignored.txt"), "not a directory");
	const outboundMessages: string[] = [];
	const registry = createTrustedRootRegistry({ builtinLocal: true });
	const executionPolicy = createAgentExecutionPolicy({ builtinLocal: true, registry });
	const session = createControllerSession(
		fromPartial({
			send: (message: string) => {
				outboundMessages.push(message);
			},
		}),
		{ executionPolicy },
	);

	try {
		session.onOpen();
		session.onMessage(
			createControllerMessage("volume.command", {
				commandId: "browse-1",
				command: { name: "filesystem.browse", path: browseRoot },
			}),
		);

		await waitForExpect(() => {
			const response = outboundMessages
				.map((message) => parseAgentMessage(message))
				.find((message) => message?.success && message.data.type === "volume.commandResult");
			expect(response?.success).toBe(true);
			if (!response || !response.success || response.data.type !== "volume.commandResult") return;
			expect(response.data.payload).toEqual({
				commandId: "browse-1",
				status: "success",
				command: {
					name: "filesystem.browse",
					result: {
						path: browseRoot,
						directories: [expect.objectContaining({ name: "backups", type: "directory" })],
					},
				},
			});
		});
	} finally {
		session.close();
		await fs.rm(browseRoot, { recursive: true, force: true });
	}
});
