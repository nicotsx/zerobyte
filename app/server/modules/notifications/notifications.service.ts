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
import { notificationConfigSchema, type NotificationConfig, type NotificationEvent } from "~/schemas/notifications";
import { toMessage } from "../../utils/errors";
import { type } from "arktype";

const listDestinations = async (organizationId: string) => {
	const destinations = await db.query.notificationDestinationsTable.findMany({
		where: eq(notificationDestinationsTable.organizationId, organizationId),
		orderBy: (destinations, { asc }) => [asc(destinations.name)],
	});
	return destinations;
};

const getDestination = async (id: number, organizationId: string) => {
	const destination = await db.query.notificationDestinationsTable.findFirst({
		where: and(eq(notificationDestinationsTable.id, id), eq(notificationDestinationsTable.organizationId, organizationId)),
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
		case "generic":
			return config;
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
		case "generic":
			return config;
		case "custom":
			return {
				...config,
				shoutrrrUrl: await cryptoUtils.resolveSecret(config.shoutrrrUrl),
			};
		default:
			return config;
	}
}

const createDestination = async (name: string, config: NotificationConfig, organizationId: string) => {
	const slug = slugify(name, { lower: true, strict: true });

	const existing = await db.query.notificationDestinationsTable.findFirst({
		where: and(eq(notificationDestinationsTable.name, slug), eq(notificationDestinationsTable.organizationId, organizationId)),
	});

	if (existing) {
		throw new ConflictError("Notification destination with this name already exists");
	}

	const encryptedConfig = await encryptSensitiveFields(config);

	const [created] = await db
		.insert(notificationDestinationsTable)
		.values({
			name: slug,
			type: config.type,
			config: encryptedConfig,
			organizationId,
		})
		.returning();

	if (!created) {
		throw new InternalServerError("Failed to create notification destination");
	}

	return created;
};

const updateDestination = async (
	id: number,
	organizationId: string,
	updates: { name?: string; enabled?: boolean; config?: NotificationConfig },
) => {
	const existing = await getDestination(id, organizationId);

	if (!existing) {
		throw new NotFoundError("Notification destination not found");
	}

	const updateData: Partial<NotificationDestination> = {
		updatedAt: Date.now(),
	};

	if (updates.name !== undefined) {
		const slug = slugify(updates.name, { lower: true, strict: true });

		const conflict = await db.query.notificationDestinationsTable.findFirst({
			where: and(eq(notificationDestinationsTable.name, slug), ne(notificationDestinationsTable.id, id), eq(notificationDestinationsTable.organizationId, organizationId)),
		});

		if (conflict) {
			throw new ConflictError("Notification destination with this name already exists");
		}
		updateData.name = slug;
	}

	if (updates.enabled !== undefined) {
		updateData.enabled = updates.enabled;
	}

	const newConfig = notificationConfigSchema(updates.config || existing.config);
	if (newConfig instanceof type.errors) {
		throw new InternalServerError("Invalid notification configuration");
	}

	const encryptedConfig = await encryptSensitiveFields(newConfig);
	updateData.config = encryptedConfig;
	updateData.type = newConfig.type;

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

const deleteDestination = async (id: number, organizationId: string) => {
	await getDestination(id, organizationId);
	await db
		.delete(notificationDestinationsTable)
		.where(and(eq(notificationDestinationsTable.id, id), eq(notificationDestinationsTable.organizationId, organizationId)));
};

const testDestination = async (id: number, organizationId: string) => {
	const destination = await getDestination(id, organizationId);

	if (!destination.enabled) {
		throw new ConflictError("Cannot test disabled notification destination");
	}

	const decryptedConfig = await decryptSensitiveFields(destination.config);

	const shoutrrrUrl = buildShoutrrrUrl(decryptedConfig);

	logger.debug("Testing notification with Shoutrrr URL:", shoutrrrUrl);

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
	const backupName = context.scheduleName ?? "backup";

	switch (event) {
		case "start":
			return {
				title: `Zerobyte ${backupName} started`,
				body: [
					`Volume: ${context.volumeName}`,
					`Repository: ${context.repositoryName}`,
					context.scheduleName ? `Schedule: ${context.scheduleName}` : null,
				]
					.filter(Boolean)
					.join("\n"),
			};

		case "success":
			return {
				title: `Zerobyte ${backupName} completed successfully`,
				body: [
					`Volume: ${context.volumeName}`,
					`Repository: ${context.repositoryName}`,
					context.scheduleName ? `Schedule: ${context.scheduleName}` : null,
					context.duration ? `Duration: ${Math.round(context.duration / 1000)}s` : null,
					context.filesProcessed !== undefined ? `Files: ${context.filesProcessed}` : null,
					context.bytesProcessed ? `Size: ${context.bytesProcessed}` : null,
					context.snapshotId ? `Snapshot: ${context.snapshotId}` : null,
				]
					.filter(Boolean)
					.join("\n"),
			};

		case "warning":
			return {
				title: `Zerobyte ${backupName} completed with warnings`,
				body: [
					`Volume: ${context.volumeName}`,
					`Repository: ${context.repositoryName}`,
					context.scheduleName ? `Schedule: ${context.scheduleName}` : null,
					context.duration ? `Duration: ${Math.round(context.duration / 1000)}s` : null,
					context.filesProcessed !== undefined ? `Files: ${context.filesProcessed}` : null,
					context.bytesProcessed ? `Size: ${context.bytesProcessed}` : null,
					context.snapshotId ? `Snapshot: ${context.snapshotId}` : null,
					context.error ? `Warning: ${context.error}` : null,
				]
					.filter(Boolean)
					.join("\n"),
			};

		case "failure":
			return {
				title: `Zerobyte ${backupName} failed`,
				body: [
					`Volume: ${context.volumeName}`,
					`Repository: ${context.repositoryName}`,
					context.scheduleName ? `Schedule: ${context.scheduleName}` : null,
					context.error ? `Error: ${context.error}` : null,
				]
					.filter(Boolean)
					.join("\n"),
			};

		default:
			return {
				title: `Zerobyte ${backupName} notification`,
				body: [
					`Volume: ${context.volumeName}`,
					`Repository: ${context.repositoryName}`,
					context.scheduleName ? `Schedule: ${context.scheduleName}` : null,
				]
					.filter(Boolean)
					.join("\n"),
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
