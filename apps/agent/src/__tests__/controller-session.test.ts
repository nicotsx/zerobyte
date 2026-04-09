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
				},
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
