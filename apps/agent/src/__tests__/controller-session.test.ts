import { afterEach, expect, test, vi } from "vitest";
import { Effect } from "effect";
import waitForExpect from "wait-for-expect";
import { fromPartial } from "@total-typescript/shoehorn";
import { createControllerMessage, parseAgentMessage } from "@zerobyte/contracts/agent-protocol";
import * as resticServer from "@zerobyte/core/restic/server";
import { createControllerSession } from "../controller-session";

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
	const session = createControllerSession(
		fromPartial({
			send: (message: string) => {
				outboundMessages.push(message);
			},
		}),
	);

	try {
		session.onOpen();
		session.onMessage(
			createControllerMessage("backup.run", {
				jobId: "job-1",
				scheduleId: "schedule-1",
				organizationId: "org-1",
				sourcePath: "/tmp/missing-source",
				repositoryConfig: {
					backend: "local",
					path: "/tmp/test-repository",
				},
				options: {},
				runtime: {
					password: "password",
					cacheDir: "/tmp/restic-cache",
					passFile: "/tmp/restic-pass",
					defaultExcludes: [],
					rcloneConfigFile: "/root/.config/rclone/rclone.conf",
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
	const outboundMessages: string[] = [];
	const session = createControllerSession(
		fromPartial({
			send: (message: string) => {
				outboundMessages.push(message);
			},
		}),
	);

	try {
		session.onMessage(
			createControllerMessage("volume.command", {
				commandId: "command-1",
				command: {
					name: "filesystem.browse",
					path: "/path/that/does/not/exist",
				},
			}),
		);
		session.onMessage(createControllerMessage("heartbeat.ping", { sentAt: 123 }));

		await waitForExpect(() => {
			const parsedMessages = outboundMessages.map((message) => parseAgentMessage(message));
			const volumeResult = parsedMessages.find(
				(message) => message?.success && message.data.type === "volume.commandResult",
			);
			const heartbeatPong = parsedMessages.find(
				(message) => message?.success && message.data.type === "heartbeat.pong",
			);

			expect(volumeResult?.success).toBe(true);
			if (!volumeResult || !volumeResult.success || volumeResult.data.type !== "volume.commandResult") {
				return;
			}

			expect(volumeResult.data.payload).toEqual({
				commandId: "command-1",
				status: "error",
				error: "ENOENT: no such file or directory, scandir '/path/that/does/not/exist'",
			});
			expect(heartbeatPong?.success).toBe(true);
			if (!heartbeatPong || !heartbeatPong.success || heartbeatPong.data.type !== "heartbeat.pong") {
				return;
			}

			expect(heartbeatPong.data.payload).toEqual({ sentAt: 123 });
		});
	} finally {
		session.close();
	}
});
