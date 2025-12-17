import { eq, and, ne } from "drizzle-orm";
import { ConflictError, InternalServerError, NotFoundError } from "http-errors-enhanced";
import slugify from "slugify";
import { db } from "../../db/db";
import {
	notificationDestinationsTable,
	backupScheduleNotificationsTable,
	type NotificationDestination,
} from "../../db/schema";
import { cryptoUtils } from "../../utils/crypto";
import { logger } from "../../utils/logger";
import { sendNotification } from "../../utils/shoutrrr";
import { buildShoutrrrUrl } from "./builders";
import { NOTIFICATION_CONFIG_SHAPES, type NotificationConfig, type NotificationEvent } from "~/schemas/notifications";
import { toMessage } from "../../utils/errors";
import { stripDiscriminatedUnion } from "~/utils/object";

const stripToNotificationConfig = (config: NotificationConfig): NotificationConfig =>
	stripDiscriminatedUnion(config, "type", NOTIFICATION_CONFIG_SHAPES) as unknown as NotificationConfig;

const listDestinations = async () => {
	const destinations = await db.query.notificationDestinationsTable.findMany({
		orderBy: (destinations, { asc }) => [asc(destinations.name)],
	});
	return destinations;
};

const getDestination = async (id: number) => {
	const destination = await db.query.notificationDestinationsTable.findFirst({
		where: eq(notificationDestinationsTable.id, id),
	});

	if (!destination) {
		throw new NotFoundError("Notification destination not found");
	}

	return destination;
};

async function encryptSensitiveFields(config: NotificationConfig): Promise<NotificationConfig> {
	switch (config.type) {
		case "email":
			return {
				...config,
				password: config.password ? await cryptoUtils.sealSecret(config.password) : undefined,
			};
		case "slack":
			return {
				...config,
				webhookUrl: await cryptoUtils.sealSecret(config.webhookUrl),
			};
		case "discord":
			return {
				...config,
				webhookUrl: await cryptoUtils.sealSecret(config.webhookUrl),
			};
		case "gotify":
			return {
				...config,
				token: await cryptoUtils.sealSecret(config.token),
			};
		case "ntfy":
			return {
				...config,
				password: config.password ? await cryptoUtils.sealSecret(config.password) : undefined,
			};
		case "pushover":
			return {
				...config,
				apiToken: await cryptoUtils.sealSecret(config.apiToken),
			};
		case "telegram":
			return {
				...config,
				botToken: await cryptoUtils.sealSecret(config.botToken),
			};
		case "custom":
			return {
				...config,
				shoutrrrUrl: await cryptoUtils.sealSecret(config.shoutrrrUrl),
			};
		default:
			return config;
	}
}

async function decryptSensitiveFields(config: NotificationConfig): Promise<NotificationConfig> {
	switch (config.type) {
		case "email":
			return {
				...config,
				password: config.password ? await cryptoUtils.resolveSecret(config.password) : undefined,
			};
		case "slack":
			return {
				...config,
				webhookUrl: await cryptoUtils.resolveSecret(config.webhookUrl),
			};
		case "discord":
			return {
				...config,
				webhookUrl: await cryptoUtils.resolveSecret(config.webhookUrl),
			};
		case "gotify":
			return {
				...config,
				token: await cryptoUtils.resolveSecret(config.token),
			};
		case "ntfy":
			return {
				...config,
				password: config.password ? await cryptoUtils.resolveSecret(config.password) : undefined,
			};
		case "pushover":
			return {
				...config,
				apiToken: await cryptoUtils.resolveSecret(config.apiToken),
			};
		case "telegram":
			return {
				...config,
				botToken: await cryptoUtils.resolveSecret(config.botToken),
			};
		case "custom":
			return {
				...config,
				shoutrrrUrl: await cryptoUtils.resolveSecret(config.shoutrrrUrl),
			};
		default:
			return config;
	}
}

const createDestination = async (name: string, config: NotificationConfig) => {
	const slug = slugify(name, { lower: true, strict: true });

	const existing = await db.query.notificationDestinationsTable.findFirst({
		where: eq(notificationDestinationsTable.name, slug),
	});

	if (existing) {
		throw new ConflictError("Notification destination with this name already exists");
	}

	const processedConfig = stripToNotificationConfig(config);
	const encryptedConfig = await encryptSensitiveFields(processedConfig);

	const [created] = await db
		.insert(notificationDestinationsTable)
		.values({
			name: slug,
			type: processedConfig.type,
			config: encryptedConfig,
		})
		.returning();

	if (!created) {
		throw new InternalServerError("Failed to create notification destination");
	}

	return created;
};

const updateDestination = async (
	id: number,
	updates: { name?: string; enabled?: boolean; config?: NotificationConfig },
) => {
	const existing = await getDestination(id);

	if (!existing) {
		throw new NotFoundError("Notification destination not found");
	}

	const updateData: Partial<NotificationDestination> = {
		updatedAt: Date.now(),
	};

	if (updates.name !== undefined) {
		const slug = slugify(updates.name, { lower: true, strict: true });

		const conflict = await db.query.notificationDestinationsTable.findFirst({
			where: and(eq(notificationDestinationsTable.name, slug), ne(notificationDestinationsTable.id, id)),
		});

		if (conflict) {
			throw new ConflictError("Notification destination with this name already exists");
		}
		updateData.name = slug;
	}

	if (updates.enabled !== undefined) {
		updateData.enabled = updates.enabled;
	}

	if (updates.config !== undefined) {
		const processedConfig = stripToNotificationConfig(updates.config);
		const encryptedConfig = await encryptSensitiveFields(processedConfig);
		updateData.config = encryptedConfig;
		updateData.type = processedConfig.type;
	}

	const [updated] = await db
		.update(notificationDestinationsTable)
		.set(updateData)
		.where(eq(notificationDestinationsTable.id, id))
		.returning();

	if (!updated) {
		throw new InternalServerError("Failed to update notification destination");
	}

	return updated;
};

const deleteDestination = async (id: number) => {
	await db.delete(notificationDestinationsTable).where(eq(notificationDestinationsTable.id, id));
};

const testDestination = async (id: number) => {
	const destination = await getDestination(id);

	if (!destination.enabled) {
		throw new ConflictError("Cannot test disabled notification destination");
	}

	const decryptedConfig = await decryptSensitiveFields(destination.config);

	const shoutrrrUrl = buildShoutrrrUrl(decryptedConfig);

	console.log("Testing notification with Shoutrrr URL:", shoutrrrUrl);

	const result = await sendNotification({
		shoutrrrUrl,
		title: "Zerobyte Test Notification",
		body: `This is a test notification from Zerobyte for destination: ${destination.name}`,
	});

	if (!result.success) {
		throw new InternalServerError(`Failed to send test notification: ${result.error}`);
	}

	return { success: true };
};

const getScheduleNotifications = async (scheduleId: number) => {
	const assignments = await db.query.backupScheduleNotificationsTable.findMany({
		where: eq(backupScheduleNotificationsTable.scheduleId, scheduleId),
		with: {
			destination: true,
		},
	});

	return assignments;
};

const updateScheduleNotifications = async (
	scheduleId: number,
	assignments: Array<{
		destinationId: number;
		notifyOnStart: boolean;
		notifyOnSuccess: boolean;
		notifyOnWarning: boolean;
		notifyOnFailure: boolean;
	}>,
) => {
	await db.delete(backupScheduleNotificationsTable).where(eq(backupScheduleNotificationsTable.scheduleId, scheduleId));

	if (assignments.length > 0) {
		await db.insert(backupScheduleNotificationsTable).values(
			assignments.map((assignment) => ({
				scheduleId,
				...assignment,
			})),
		);
	}

	return getScheduleNotifications(scheduleId);
};

const sendBackupNotification = async (
	scheduleId: number,
	event: NotificationEvent,
	context: {
		volumeName: string;
		repositoryName: string;
		scheduleName?: string;
		error?: string;
		duration?: number;
		filesProcessed?: number;
		bytesProcessed?: string;
		snapshotId?: string;
	},
) => {
	try {
		const assignments = await db.query.backupScheduleNotificationsTable.findMany({
			where: eq(backupScheduleNotificationsTable.scheduleId, scheduleId),
			with: {
				destination: true,
			},
		});

		const relevantAssignments = assignments.filter((assignment) => {
			if (!assignment.destination.enabled) return false;

			switch (event) {
				case "start":
					return assignment.notifyOnStart;
				case "success":
					return assignment.notifyOnSuccess;
				case "warning":
					return assignment.notifyOnWarning;
				case "failure":
					return assignment.notifyOnFailure;
				default:
					return false;
			}
		});

		if (!relevantAssignments.length) {
			logger.debug(`No notification destinations configured for backup ${scheduleId} event ${event}`);
			return;
		}

		const { title, body } = buildNotificationMessage(event, context);

		for (const assignment of relevantAssignments) {
			try {
				const decryptedConfig = await decryptSensitiveFields(assignment.destination.config);
				const shoutrrrUrl = buildShoutrrrUrl(decryptedConfig);

				const result = await sendNotification({
					shoutrrrUrl,
					title,
					body,
				});

				if (result.success) {
					logger.info(
						`Notification sent successfully to ${assignment.destination.name} for backup ${scheduleId} event ${event}`,
					);
				} else {
					logger.error(
						`Failed to send notification to ${assignment.destination.name} for backup ${scheduleId}: ${result.error}`,
					);
				}
			} catch (error) {
				logger.error(
					`Error sending notification to ${assignment.destination.name} for backup ${scheduleId}: ${toMessage(error)}`,
				);
			}
		}
	} catch (error) {
		logger.error(`Error processing backup notifications for schedule ${scheduleId}: ${toMessage(error)}`);
	}
};

function buildNotificationMessage(
	event: NotificationEvent,
	context: {
		volumeName: string;
		repositoryName: string;
		scheduleName?: string;
		error?: string;
		duration?: number;
		filesProcessed?: number;
		bytesProcessed?: string;
		snapshotId?: string;
	},
) {
	const date = new Date().toLocaleDateString();
	const time = new Date().toLocaleTimeString();

	switch (event) {
		case "start":
			return {
				title: "🔵 Backup Started",
				body: [
					`Volume: ${context.volumeName}`,
					`Repository: ${context.repositoryName}`,
					context.scheduleName ? `Schedule: ${context.scheduleName}` : null,
					`Time: ${date} - ${time}`,
				]
					.filter(Boolean)
					.join("\n"),
			};

		case "success":
			return {
				title: "✅ Backup Completed successfully",
				body: [
					`Volume: ${context.volumeName}`,
					`Repository: ${context.repositoryName}`,
					context.duration ? `Duration: ${Math.round(context.duration / 1000)}s` : null,
					context.filesProcessed !== undefined ? `Files: ${context.filesProcessed}` : null,
					context.bytesProcessed ? `Size: ${context.bytesProcessed}` : null,
					context.snapshotId ? `Snapshot: ${context.snapshotId}` : null,
					`Time: ${date} - ${time}`,
				]
					.filter(Boolean)
					.join("\n"),
			};

		case "warning":
			return {
				title: "! Backup completed with warnings",
				body: [
					`Volume: ${context.volumeName}`,
					`Repository: ${context.repositoryName}`,
					context.duration ? `Duration: ${Math.round(context.duration / 1000)}s` : null,
					context.filesProcessed !== undefined ? `Files: ${context.filesProcessed}` : null,
					context.bytesProcessed ? `Size: ${context.bytesProcessed}` : null,
					context.snapshotId ? `Snapshot: ${context.snapshotId}` : null,
					context.error ? `Warning: ${context.error}` : null,
					`Time: ${date} - ${time}`,
				]
					.filter(Boolean)
					.join("\n"),
			};

		case "failure":
			return {
				title: "❌ Backup failed",
				body: [
					`Volume: ${context.volumeName}`,
					`Repository: ${context.repositoryName}`,
					context.error ? `Error: ${context.error}` : null,
					`Time: ${date} - ${time}`,
				]
					.filter(Boolean)
					.join("\n"),
			};

		default:
			return {
				title: "Backup Notification",
				body: `Volume: ${context.volumeName}\nRepository: ${context.repositoryName}\nTime: ${date} - ${time}`,
			};
	}
}

export const notificationsService = {
	listDestinations,
	getDestination,
	createDestination,
	updateDestination,
	deleteDestination,
	testDestination,
	getScheduleNotifications,
	updateScheduleNotifications,
	sendBackupNotification,
};
