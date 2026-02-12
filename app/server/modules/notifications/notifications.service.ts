import { eq, and } from "drizzle-orm";
import { BadRequestError, ConflictError, InternalServerError, NotFoundError } from "http-errors-enhanced";
import { db } from "../../db/db";
import {
	notificationDestinationsTable,
	backupScheduleNotificationsTable,
	type NotificationDestination,
} from "../../db/schema";
import { cryptoUtils } from "../../utils/crypto";
import { logger } from "../../utils/logger";
import { sendNotification } from "../../utils/shoutrrr";
import type { BackupOutput } from "../../utils/restic";
import { formatDuration } from "~/utils/utils";
import { buildShoutrrrUrl } from "./builders";
import { notificationConfigSchema, type NotificationConfig, type NotificationEvent } from "~/schemas/notifications";
import { toMessage } from "../../utils/errors";
import { type } from "arktype";
import { getOrganizationId } from "~/server/core/request-context";
import { formatBytes } from "~/utils/format-bytes";

const listDestinations = async () => {
	const organizationId = getOrganizationId();
	const destinations = await db.query.notificationDestinationsTable.findMany({
		where: { organizationId },
		orderBy: { name: "asc" },
	});
	return destinations;
};

const getDestination = async (id: number) => {
	const organizationId = getOrganizationId();
	const destination = await db.query.notificationDestinationsTable.findFirst({
		where: { AND: [{ id }, { organizationId }] },
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

const createDestination = async (name: string, config: NotificationConfig) => {
	const organizationId = getOrganizationId();
	const trimmedName = name.trim();

	if (trimmedName.length === 0) {
		throw new BadRequestError("Name cannot be empty");
	}

	const encryptedConfig = await encryptSensitiveFields(config);

	const [created] = await db
		.insert(notificationDestinationsTable)
		.values({
			name: trimmedName,
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
	updates: { name?: string; enabled?: boolean; config?: NotificationConfig },
) => {
	const organizationId = getOrganizationId();
	const existing = await getDestination(id);

	if (!existing) {
		throw new NotFoundError("Notification destination not found");
	}

	const updateData: Partial<NotificationDestination> = {
		updatedAt: Date.now(),
	};

	if (updates.name !== undefined) {
		const trimmedName = updates.name.trim();
		if (trimmedName.length === 0) {
			throw new BadRequestError("Name cannot be empty");
		}
		updateData.name = trimmedName;
	}

	if (updates.enabled !== undefined) {
		updateData.enabled = updates.enabled;
	}

	const newConfig = notificationConfigSchema(updates.config || existing.config);
	if (newConfig instanceof type.errors) {
		throw new BadRequestError("Invalid notification configuration");
	}

	const encryptedConfig = await encryptSensitiveFields(newConfig);
	updateData.config = encryptedConfig;
	updateData.type = newConfig.type;

	const [updated] = await db
		.update(notificationDestinationsTable)
		.set(updateData)
		.where(
			and(eq(notificationDestinationsTable.id, id), eq(notificationDestinationsTable.organizationId, organizationId)),
		)
		.returning();

	if (!updated) {
		throw new InternalServerError("Failed to update notification destination");
	}

	return updated;
};

const deleteDestination = async (id: number) => {
	const organizationId = getOrganizationId();
	await getDestination(id);
	await db
		.delete(notificationDestinationsTable)
		.where(
			and(eq(notificationDestinationsTable.id, id), eq(notificationDestinationsTable.organizationId, organizationId)),
		);
};

const testDestination = async (id: number) => {
	const destination = await getDestination(id);

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
	const organizationId = getOrganizationId();
	const schedule = await db.query.backupSchedulesTable.findFirst({
		where: { AND: [{ id: scheduleId }, { organizationId }] },
	});

	if (!schedule) {
		throw new NotFoundError("Backup schedule not found");
	}

	const assignments = await db.query.backupScheduleNotificationsTable.findMany({
		where: { scheduleId },
		with: {
			destination: true,
		},
	});

	return assignments.filter((a) => a.destination.organizationId === organizationId);
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
	const organizationId = getOrganizationId();
	const schedule = await db.query.backupSchedulesTable.findFirst({
		where: { AND: [{ id: scheduleId }, { organizationId }] },
	});

	if (!schedule) {
		throw new NotFoundError("Backup schedule not found");
	}

	const destinationIds = [...new Set(assignments.map((a) => a.destinationId))];
	if (destinationIds.length > 0) {
		const destinations = await db.query.notificationDestinationsTable.findMany({
			where: {
				AND: [{ id: { in: destinationIds } }, { organizationId }],
			},
		});

		if (destinations.length !== destinationIds.length) {
			throw new NotFoundError("One or more notification destinations were not found");
		}
	}

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

type BackupSummary = Omit<BackupOutput, "message_type">;

const formatBytesText = (bytes: number) => {
	const { text, unit } = formatBytes(bytes, {
		base: 1024,
		locale: "en-US",
		fallback: "-",
	});

	return unit ? `${text} ${unit}` : text;
};

const buildBackupSummaryLines = (summary?: BackupSummary) => {
	if (!summary) return [];

	const safeNumber = (value: number | undefined) => (typeof value === "number" && Number.isFinite(value) ? value : 0);
	const safeCountText = (value: number | undefined) => safeNumber(value).toLocaleString();
	const safeBytesText = (value: number | undefined) => formatBytesText(safeNumber(value));
	const safeDurationText = (value: number | undefined) =>
		typeof value === "number" && Number.isFinite(value) ? formatDuration(Math.round(value)) : "N/A";
	const snapshotText = summary.snapshot_id ?? "N/A";

	const lines = [
		"Overview:",
		`- Data added: ${safeBytesText(summary.data_added)}`,
		summary.data_added_packed !== undefined ? `- Data stored: ${safeBytesText(summary.data_added_packed)}` : null,
		`- Total files processed: ${safeCountText(summary.total_files_processed)}`,
		`- Total bytes processed: ${safeBytesText(summary.total_bytes_processed)}`,
		"Backup Statistics:",
		`- Files new: ${safeCountText(summary.files_new)}`,
		`- Files changed: ${safeCountText(summary.files_changed)}`,
		`- Files unmodified: ${safeCountText(summary.files_unmodified)}`,
		`- Dirs new: ${safeCountText(summary.dirs_new)}`,
		`- Dirs changed: ${safeCountText(summary.dirs_changed)}`,
		`- Dirs unmodified: ${safeCountText(summary.dirs_unmodified)}`,
		`- Data blobs: ${safeCountText(summary.data_blobs)}`,
		`- Tree blobs: ${safeCountText(summary.tree_blobs)}`,
		`- Total duration: ${safeDurationText(summary.total_duration)}`,
		`- Snapshot: ${snapshotText}`,
	];

	return lines.filter((line): line is string => Boolean(line));
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
		summary?: BackupSummary;
	},
) => {
	try {
		const organizationId = getOrganizationId();

		const assignments = await db.query.backupScheduleNotificationsTable.findMany({
			where: { scheduleId },
			with: {
				destination: true,
			},
		});

		const relevantAssignments = assignments.filter((assignment) => {
			if (assignment.destination.organizationId !== organizationId) return false;
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
		summary?: BackupSummary;
	},
) {
	const backupName = context.scheduleName ?? "backup";
	const derivedDuration =
		context.duration ?? (context.summary?.total_duration ? context.summary.total_duration * 1000 : undefined);
	const derivedFilesProcessed = context.filesProcessed ?? context.summary?.total_files_processed;
	const derivedBytesProcessed =
		context.bytesProcessed ?? (context.summary ? formatBytesText(context.summary.total_bytes_processed) : undefined);
	const derivedSnapshotId = context.snapshotId ?? context.summary?.snapshot_id;
	const summaryLines = buildBackupSummaryLines(context.summary);

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
					derivedDuration ? `Duration: ${Math.round(derivedDuration / 1000)}s` : null,
					derivedFilesProcessed !== undefined ? `Files: ${derivedFilesProcessed.toLocaleString()}` : null,
					derivedBytesProcessed ? `Size: ${derivedBytesProcessed}` : null,
					derivedSnapshotId ? `Snapshot: ${derivedSnapshotId}` : null,
					...summaryLines,
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
					derivedDuration ? `Duration: ${Math.round(derivedDuration / 1000)}s` : null,
					derivedFilesProcessed !== undefined ? `Files: ${derivedFilesProcessed.toLocaleString()}` : null,
					derivedBytesProcessed ? `Size: ${derivedBytesProcessed}` : null,
					derivedSnapshotId ? `Snapshot: ${derivedSnapshotId}` : null,
					context.error ? `Warning: ${context.error}` : null,
					...summaryLines,
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
