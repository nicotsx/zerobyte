import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { expect, test } from "./test";
import { gotoAndWaitForAppReady } from "./helpers/page";
import { startWebhookReceiver } from "./helpers/webhook-receiver";

const receiverPort = 18080;
const receiverOrigin = `http://host.docker.internal:${receiverPort}`;
const testDataPath = path.join(process.cwd(), "playwright", "temp");

type BackupSchedule = {
	shortId: string;
	lastBackupStatus: "success" | "error" | "in_progress" | "warning" | null;
	lastBackupError: string | null;
};

function prepareTestFile(runId: string) {
	const runPath = path.join(testDataPath, runId);
	fs.mkdirSync(runPath, { recursive: true });
	fs.writeFileSync(path.join(runPath, "notification-webhook-test.json"), JSON.stringify({ runId }));
	return `/test-data/${runId}`;
}

test("delivers notification destinations and backup lifecycle webhooks", async ({ page }, testInfo) => {
	const receiver = await startWebhookReceiver(receiverPort);

	try {
		const runId = `${testInfo.parallelIndex}-${testInfo.retry}-${randomUUID().slice(0, 8)}`;
		const sourcePath = prepareTestFile(runId);
		const repositoryPath = `/var/lib/zerobyte/data/repos/${runId}`;

		await gotoAndWaitForAppReady(page, "/");
		await expect(page).toHaveURL("/volumes");

		const volumeResponse = await page.request.post("/api/v1/volumes", {
			data: {
				name: `Volume-${runId}`,
				config: { backend: "directory", path: sourcePath, readOnly: false },
			},
		});
		expect(volumeResponse.ok()).toBe(true);
		const volume = (await volumeResponse.json()) as { shortId: string };

		const repositoryResponse = await page.request.post("/api/v1/repositories", {
			data: {
				name: `Repo-${runId}`,
				config: { backend: "local", path: repositoryPath, isExistingRepository: false },
			},
		});
		expect(repositoryResponse.ok()).toBe(true);
		const repository = (await repositoryResponse.json()) as { repository: { shortId: string } };

		const notificationResponse = await page.request.post("/api/v1/notifications/destinations", {
			data: {
				name: `Notify-${runId}`,
				config: {
					type: "generic",
					url: `${receiverOrigin}/notifications`,
					method: "POST",
					contentType: "application/json",
					headers: ["X-Zerobyte-E2E: notifications"],
					useJson: true,
					titleKey: "title",
					messageKey: "message",
				},
			},
		});
		expect(notificationResponse.ok()).toBe(true);
		const notification = (await notificationResponse.json()) as { id: number };

		const testNotificationResponse = await page.request.post(
			`/api/v1/notifications/destinations/${notification.id}/test`,
		);
		expect(testNotificationResponse.ok()).toBe(true);
		await receiver.waitFor(
			(request) => request.path === "/notifications" && request.body.includes("Zerobyte Test Notification"),
		);

		const scheduleResponse = await page.request.post("/api/v1/backups", {
			data: {
				name: `Backup-${runId}`,
				volumeId: volume.shortId,
				repositoryId: repository.repository.shortId,
				enabled: false,
				cronExpression: "",
				includePaths: [],
				excludePatterns: [],
				excludeIfPresent: [],
				includePatterns: [],
				oneFileSystem: false,
				backupWebhooks: {
					pre: {
						url: `${receiverOrigin}/backup/pre`,
						headers: ["X-Zerobyte-E2E: pre"],
					},
					post: {
						url: `${receiverOrigin}/backup/post`,
						headers: ["X-Zerobyte-E2E: post"],
					},
				},
				maxRetries: 0,
				retryDelay: 1,
			},
		});
		expect(scheduleResponse.ok()).toBe(true);
		const schedule = (await scheduleResponse.json()) as BackupSchedule;

		const assignmentResponse = await page.request.put(`/api/v1/backups/${schedule.shortId}/notifications`, {
			data: {
				assignments: [
					{
						destinationId: notification.id,
						notifyOnStart: true,
						notifyOnSuccess: true,
						notifyOnWarning: true,
						notifyOnFailure: true,
					},
				],
			},
		});
		expect(assignmentResponse.ok()).toBe(true);

		const runResponse = await page.request.post(`/api/v1/backups/${schedule.shortId}/run`);
		expect(runResponse.ok()).toBe(true);

		await receiver.waitFor(
			(request) =>
				request.path === "/notifications" &&
				request.body.includes(`Zerobyte Backup-${runId} started`) &&
				request.body.includes(`Volume-${runId}`),
		);

		const preWebhook = await receiver.waitFor((request) => request.path === "/backup/pre");
		expect(preWebhook.method).toBe("POST");
		expect(preWebhook.headers["x-zerobyte-e2e"]).toBe("pre");
		expect(preWebhook.json).toMatchObject({
			phase: "pre",
			event: "backup.pre",
			scheduleId: schedule.shortId,
			sourcePath,
		});

		const postWebhook = await receiver.waitFor((request) => request.path === "/backup/post");
		expect(postWebhook.method).toBe("POST");
		expect(postWebhook.headers["x-zerobyte-e2e"]).toBe("post");
		expect(postWebhook.json).toMatchObject({
			phase: "post",
			event: "backup.post",
			scheduleId: schedule.shortId,
			sourcePath,
			status: "success",
		});

		await receiver.waitFor(
			(request) =>
				request.path === "/notifications" &&
				request.body.includes(`Zerobyte Backup-${runId} completed successfully`) &&
				request.body.includes(`Repo-${runId}`),
		);

		await expect(async () => {
			const latestScheduleResponse = await page.request.get(`/api/v1/backups/${schedule.shortId}`);
			expect(latestScheduleResponse.ok()).toBe(true);
			const latestSchedule = (await latestScheduleResponse.json()) as BackupSchedule;
			expect(latestSchedule.lastBackupStatus).toBe("success");
			expect(latestSchedule.lastBackupError).toBeNull();
		}).toPass({ timeout: 30000 });
	} finally {
		await receiver.close();
	}
});
