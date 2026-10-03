import { afterEach, expect, test, vi } from "vitest";
import { db } from "~/server/db/db";
import { backupScheduleNotificationsTable, notificationDestinationsTable } from "~/server/db/schema";
import { withContext } from "~/server/core/request-context";
import { serverEvents } from "~/server/core/events";
import { createTestBackupSchedule } from "~/test/helpers/backup";
import { createTestOrganization } from "~/test/helpers/organization";
import * as shoutrrr from "~/server/utils/shoutrrr";
import { notificationsService } from "../notifications.service";

vi.unmock("~/server/utils/crypto");

const mirrorContext = {
	scheduleName: "Nightly backup",
	sourceRepositoryName: "Primary repository",
	mirrorRepositoryName: "Cloud mirror",
	error: "Cloud connection lost",
};

const setup = async () => {
	const organization = await createTestOrganization();
	const schedule = await createTestBackupSchedule({ name: mirrorContext.scheduleName });
	const requestContext = { organizationId: organization.id };

	const destination = await withContext(requestContext, () =>
		notificationsService.createDestination("Failure alerts", {
			type: "custom",
			shoutrrrUrl: "discord://token@webhookid",
		}),
	);

	await db.insert(backupScheduleNotificationsTable).values({
		scheduleId: schedule.id,
		destinationId: destination.id,
		notifyOnFailure: true,
	});

	return { schedule, destination, requestContext };
};

afterEach(() => {
	vi.restoreAllMocks();
});

test("sends an identifiable mirror failure to encrypted schedule destinations and updates delivery status", async () => {
	const { schedule, destination, requestContext } = await setup();
	const send = vi.spyOn(shoutrrr, "sendNotification").mockResolvedValue({ success: true });
	const event = new Promise<Parameters<typeof serverEvents.emit>[1]>((resolve) => {
		serverEvents.once("notification:updated", resolve);
	});

	await withContext(requestContext, () =>
		notificationsService.sendMirrorSyncFailureNotification(schedule.id, mirrorContext),
	);

	expect(destination.config).toMatchObject({ shoutrrrUrl: expect.stringMatching(/^encv1:/) });
	expect(send).toHaveBeenCalledExactlyOnceWith({
		shoutrrrUrl: "discord://token@webhookid",
		title: "Zerobyte Nightly backup mirror sync failed",
		body: [
			"Schedule: Nightly backup",
			"Source repository: Primary repository",
			"Mirror repository: Cloud mirror",
			"Error: Cloud connection lost",
		].join("\n"),
	});
	await expect(event).resolves.toMatchObject({
		organizationId: requestContext.organizationId,
		notificationId: destination.id,
		status: "healthy",
	});

	const updated = await db.query.notificationDestinationsTable.findFirst({ where: { id: destination.id } });

	expect(updated).toMatchObject({ status: "healthy", lastChecked: expect.any(Number), lastError: null });
});

test("delivers only to enabled failure subscribers for this schedule and organization", async () => {
	const { schedule, destination, requestContext } = await setup();
	const otherOrganization = await createTestOrganization({ id: "other-org" });
	const otherSchedule = await createTestBackupSchedule();
	const skippedDestinations = await db
		.insert(notificationDestinationsTable)
		.values(
			[
				{ name: "Disabled", enabled: false, organizationId: requestContext.organizationId },
				{ name: "Success only", organizationId: requestContext.organizationId },
				{ name: "Other organization", organizationId: otherOrganization.id },
				{ name: "Other schedule", organizationId: requestContext.organizationId },
			].map((fields) => ({
				...fields,
				type: "custom" as const,
				config: { type: "custom" as const, shoutrrrUrl: "discord://other@webhookid" },
			})),
		)
		.returning();

	await db.insert(backupScheduleNotificationsTable).values(
		skippedDestinations.map((skipped) => ({
			scheduleId: skipped.name === "Other schedule" ? otherSchedule.id : schedule.id,
			destinationId: skipped.id,
			notifyOnStart: true,
			notifyOnSuccess: true,
			notifyOnWarning: true,
			notifyOnFailure: skipped.name !== "Success only",
		})),
	);

	const send = vi.spyOn(shoutrrr, "sendNotification").mockResolvedValue({ success: true });

	await withContext(requestContext, () =>
		notificationsService.sendMirrorSyncFailureNotification(schedule.id, mirrorContext),
	);

	expect(send).toHaveBeenCalledTimes(1);

	for (const skipped of skippedDestinations) {
		const updated = await db.query.notificationDestinationsTable.findFirst({ where: { id: skipped.id } });

		expect(updated).toMatchObject({ status: "unknown", lastChecked: null });
	}

	const updated = await db.query.notificationDestinationsTable.findFirst({ where: { id: destination.id } });

	expect(updated?.status).toBe("healthy");
});

test("does not send when the schedule has no notification assignments", async () => {
	const schedule = await createTestBackupSchedule();
	const send = vi.spyOn(shoutrrr, "sendNotification").mockResolvedValue({ success: true });

	await withContext({ organizationId: schedule.organizationId }, () =>
		notificationsService.sendMirrorSyncFailureNotification(schedule.id, mirrorContext),
	);

	expect(send).not.toHaveBeenCalled();
});

test.each(["returned failure", "thrown error"])(
	"records a %s and continues delivering to other destinations",
	async (failureMode) => {
		const { schedule, destination, requestContext } = await setup();

		const secondDestination = await withContext(requestContext, () =>
			notificationsService.createDestination("Second destination", {
				type: "custom",
				shoutrrrUrl: "discord://second@webhookid",
			}),
		);

		await db.insert(backupScheduleNotificationsTable).values({
			scheduleId: schedule.id,
			destinationId: secondDestination.id,
			notifyOnFailure: true,
		});

		const send = vi.spyOn(shoutrrr, "sendNotification").mockImplementation(async ({ shoutrrrUrl }) => {
			if (shoutrrrUrl === "discord://token@webhookid") {
				if (failureMode === "thrown error") throw new Error("Delivery unavailable");

				return { success: false, error: "Delivery unavailable" };
			}

			return { success: true };
		});

		await expect(
			withContext(requestContext, () =>
				notificationsService.sendMirrorSyncFailureNotification(schedule.id, mirrorContext),
			),
		).resolves.toBeUndefined();

		expect(send).toHaveBeenCalledTimes(2);

		const failed = await db.query.notificationDestinationsTable.findFirst({ where: { id: destination.id } });
		const delivered = await db.query.notificationDestinationsTable.findFirst({
			where: { id: secondDestination.id },
		});

		expect(failed).toMatchObject({
			status: "error",
			lastChecked: expect.any(Number),
			lastError: "Delivery unavailable",
		});
		expect(delivered).toMatchObject({ status: "healthy", lastError: null });
	},
);

test("blocks disallowed webhook targets and records the delivery error", async () => {
	const { schedule, requestContext } = await setup();

	const [destination] = await db
		.insert(notificationDestinationsTable)
		.values({
			name: "Blocked webhook",
			type: "generic",
			config: { type: "generic", url: "https://blocked.example.invalid/webhook", method: "POST" },
			organizationId: requestContext.organizationId,
		})
		.returning();

	await db.insert(backupScheduleNotificationsTable).values({
		scheduleId: schedule.id,
		destinationId: destination.id,
		notifyOnFailure: true,
	});

	const send = vi.spyOn(shoutrrr, "sendNotification").mockResolvedValue({ success: true });

	await withContext(requestContext, () =>
		notificationsService.sendMirrorSyncFailureNotification(schedule.id, mirrorContext),
	);

	expect(send).toHaveBeenCalledTimes(1);
	expect(send).toHaveBeenCalledWith(expect.objectContaining({ shoutrrrUrl: "discord://token@webhookid" }));

	const updated = await db.query.notificationDestinationsTable.findFirst({ where: { id: destination.id } });

	expect(updated).toMatchObject({ status: "error", lastError: expect.stringContaining("not allowed") });
});

test.each([
	{ event: "start", title: "Zerobyte Nightly backup started", detail: "" },
	{ event: "success", title: "Zerobyte Nightly backup completed successfully", detail: "" },
	{ event: "warning", title: "Zerobyte Nightly backup completed with warnings", detail: "\nWarning: Backup warning" },
	{ event: "failure", title: "Zerobyte Nightly backup failed", detail: "\nError: Backup warning" },
] as const)("preserves the backup $event message", async ({ event, title, detail }) => {
	const { schedule, destination, requestContext } = await setup();

	await withContext(requestContext, () =>
		notificationsService.updateScheduleNotifications(schedule.id, [
			{
				destinationId: destination.id,
				notifyOnStart: true,
				notifyOnSuccess: true,
				notifyOnWarning: true,
				notifyOnFailure: true,
			},
		]),
	);

	const send = vi.spyOn(shoutrrr, "sendNotification").mockResolvedValue({ success: true });

	await withContext(requestContext, () =>
		notificationsService.sendBackupNotification(schedule.id, event, {
			volumeName: "Documents",
			repositoryName: mirrorContext.sourceRepositoryName,
			scheduleName: mirrorContext.scheduleName,
			error: "Backup warning",
		}),
	);

	expect(send).toHaveBeenCalledExactlyOnceWith({
		shoutrrrUrl: "discord://token@webhookid",
		title,
		body: `Volume: Documents\nRepository: Primary repository\nSchedule: Nightly backup${detail}`,
	});
});
