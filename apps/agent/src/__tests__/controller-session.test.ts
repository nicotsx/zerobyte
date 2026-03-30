import { afterEach, expect, mock, spyOn, test } from "bun:test";
import { Effect } from "effect";
import waitForExpect from "wait-for-expect";
import { fromAny } from "@total-typescript/shoehorn";
import { createControllerMessage, parseAgentMessage } from "@zerobyte/contracts/agent-protocol";
import * as resticServer from "@zerobyte/core/restic/server";
import { createControllerSession } from "../controller-session";

afterEach(() => {
	mock.restore();
});

test("emits backup.failed when a backup command hits a restic error", async () => {
	spyOn(resticServer, "createRestic").mockReturnValue(
		fromAny({
			backup: () => Effect.fail(new Error("source path missing")),
		}),
	);

	const outboundMessages: string[] = [];
	const session = createControllerSession(
		fromAny({
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
