import { eq, and } from "drizzle-orm";
import { BadRequestError, InternalServerError, NotFoundError } from "http-errors-enhanced";
import { db } from "../../db/db";
import {
	notificationDestinationsTable,
	backupScheduleNotificationsTable,
	type NotificationDestination,
} from "../../db/schema";
import { logger } from "@zerobyte/core/node";
import { isAllowedWebhookUrl } from "@zerobyte/core/backup-hooks";
import { sendNotification } from "../../utils/shoutrrr";
import { formatDuration } from "~/utils/utils";
import { buildShoutrrrUrl } from "./builders";
import { notificationConfigSchema, type NotificationConfig, type NotificationEvent } from "~/schemas/notifications";
import type { ResticBackupRunSummaryDto } from "@zerobyte/core/restic";
import { toMessage } from "../../utils/errors";
import { config } from "~/server/core/config";
import { getOrganizationId } from "~/server/core/request-context";
import { formatBytes } from "~/utils/format-bytes";
import { decryptNotificationConfig, encryptNotificationConfig } from "./notification-config-secrets";
import { serverEvents } from "~/server/core/events";

const getCustomShoutrrrWebhookUrl = (shoutrrrUrl: string) => {
	if (!URL.canParse(shoutrrrUrl)) {
		return null;
	}

	const parsedUrl = new URL(shoutrrrUrl);
	const protocol = parsedUrl.protocol.toLowerCase();

	if (protocol === "generic:") {
		const scheme = parsedUrl.searchParams.get("disabletls") === "yes" ? "http" : "https";
		return `${scheme}://${parsedUrl.host}`;
	}

	if (protocol === "gotify:") {
		const scheme = parsedUrl.searchParams.get("DisableTLS") === "true" ? "http" : "https";
		return `${scheme}://${parsedUrl.host}`;
	}

	if (protocol === "ntfy:" && parsedUrl.hostname !== "ntfy.sh") {
		const scheme = parsedUrl.searchParams.get("scheme") === "http" ? "http" : "https";
		return `${scheme}://${parsedUrl.host}`;
	}

	return null;
};

const getNotificationWebhookUrl = (notificationConfig: NotificationConfig) => {
	switch (notificationConfig.type) {
		case "generic":
			return notificationConfig.url;
		case "gotify":
			return notificationConfig.serverUrl;
		case "ntfy":
			return notificationConfig.serverUrl ?? null;
		case "custom":
			return getCustomShoutrrrWebhookUrl(notificationConfig.shoutrrrUrl);
		default:
			return null;
	}
};

const assertNotificationWebhookOriginAllowed = (notificationConfig: NotificationConfig) => {
	const webhookUrl = getNotificationWebhookUrl(notificationConfig);
	if (!webhookUrl) {
		return;
	}

	if (!isAllowedWebhookUrl(webhookUrl, config.webhookAllowedOrigins)) {
		const webhookOrigin = URL.canParse(webhookUrl) ? new URL(webhookUrl).origin : webhookUrl;
		throw new BadRequestError(
			`Notification webhook URL origin is not allowed. Add ${webhookOrigin} to WEBHOOK_ALLOWED_ORIGINS.`,
		);
	}
};

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

const createDestination = async (name: string, config: NotificationConfig) => {
	const organizationId = getOrganizationId();
	const trimmedName = name.trim();

	if (trimmedName.length === 0) {
		throw new BadRequestError("Name cannot be empty");
	}

	assertNotificationWebhookOriginAllowed(config);

	const encryptedConfig = await encryptNotificationConfig(config);

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

	const newConfigResult = notificationConfigSchema.safeParse(updates.config || existing.config);
	if (!newConfigResult.success) {
		throw new BadRequestError("Invalid notification configuration");
	}
	const newConfig = newConfigResult.data;
	assertNotificationWebhookOriginAllowed(newConfig);

	const encryptedConfig = await encryptNotificationConfig(newConfig);
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

const updateDeliveryStatus = async (destinationId: number, result: { success: boolean; error?: string }) => {
	const [updated] = await db
		.update(notificationDestinationsTable)
		.set({
			status: result.success ? "healthy" : "error",
			lastChecked: Date.now(),
			lastError: result.success ? null : (result.error ?? "Unknown error"),
			updatedAt: Date.now(),
		})
		.where(eq(notificationDestinationsTable.id, destinationId))
		.returning();

	if (updated) {
		serverEvents.emit("notification:updated", {
			organizationId: updated.organizationId,
			notificationId: updated.id,
			notificationName: updated.name,
			status: updated.status,
		});
	}
};

const testDestination = async (id: number) => {
	const destination = await getDestination(id);
	let result: Awaited<ReturnType<typeof sendNotification>>;

	try {
		const decryptedConfig = await decryptNotificationConfig(destination.config);
		assertNotificationWebhookOriginAllowed(decryptedConfig);

		const shoutrrrUrl = buildShoutrrrUrl(decryptedConfig);

		logger.debug("Testing notification with Shoutrrr URL:", shoutrrrUrl);

		result = await sendNotification({
			shoutrrrUrl,
			title: "Zerobyte Test Notification",
			body: `This is a test notification from Zerobyte for destination: ${destination.name}`,
		});
	} catch (error) {
		await updateDeliveryStatus(destination.id, { success: false, error: toMessage(error) });
		throw error;
	}

	await updateDeliveryStatus(destination.id, result);

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

const formatBytesText = (bytes: number) => {
	const { text, unit } = formatBytes(bytes, {
		base: 1024,
		locale: "en-US",
		fallback: "-",
	});

	return unit ? `${text} ${unit}` : text;
};

const buildBackupNotificationLines = (summary?: ResticBackupRunSummaryDto) => {
	if (!summary) return [];

	const safeNumber = (value: number | undefined) => (typeof value === "number" && Number.isFinite(value) ? value : 0);
	const safeCountText = (value: number | undefined) => safeNumber(value).toLocaleString();
	const safeBytesText = (value: number | undefined) => formatBytesText(safeNumber(value));
	const safeDurationText = (value: number | undefined) =>
		typeof value === "number" && Number.isFinite(value) ? formatDuration(Math.round(value)) : "N/A";

	const hasDetailedStats = summary.files_new || summary.files_changed || summary.dirs_new || summary.data_blobs;

	if (!hasDetailedStats) {
		const lines: (string | null)[] = [];

		if (summary.total_duration) {
			lines.push(`Duration: ${Math.round(summary.total_duration)}s`);
		}
		if (summary.total_files_processed !== undefined) {
			lines.push(`Files: ${summary.total_files_processed.toLocaleString()}`);
		}
		if (summary.total_bytes_processed !== undefined) {
			lines.push(`Size: ${safeBytesText(summary.total_bytes_processed)}`);
		}
		if (summary.snapshot_id) {
			lines.push(`Snapshot: ${summary.snapshot_id}`);
		}

		return lines.filter((line): line is string => Boolean(line));
	}

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

	return lines.filter(Boolean);
};

const sendBackupNotification = async (
	scheduleId: number,
	event: NotificationEvent,
	context: {
		volumeName: string;
		repositoryName: string;
		scheduleName?: string;
		error?: string;
		summary?: ResticBackupRunSummaryDto;
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
				const decryptedConfig = await decryptNotificationConfig(assignment.destination.config);
				assertNotificationWebhookOriginAllowed(decryptedConfig);
				const shoutrrrUrl = buildShoutrrrUrl(decryptedConfig);

				const result = await sendNotification({ shoutrrrUrl, title, body });
				await updateDeliveryStatus(assignment.destination.id, result);

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
				await updateDeliveryStatus(assignment.destination.id, { success: false, error: toMessage(error) });
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
		summary?: ResticBackupRunSummaryDto;
	},
) {
	const backupName = context.scheduleName ?? "backup";
	const notificationLines = buildBackupNotificationLines(context.summary);

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

		case "success": {
			const bodyLines = [
				`Volume: ${context.volumeName}`,
				`Repository: ${context.repositoryName}`,
				context.scheduleName ? `Schedule: ${context.scheduleName}` : null,
				...notificationLines,
			];

			return {
				title: `Zerobyte ${backupName} completed successfully`,
				body: bodyLines.filter(Boolean).join("\n"),
			};
		}

		case "warning": {
			const bodyLines = [
				`Volume: ${context.volumeName}`,
				`Repository: ${context.repositoryName}`,
				context.scheduleName ? `Schedule: ${context.scheduleName}` : null,
				context.error ? `Warning: ${context.error}` : null,
				...notificationLines,
			];

			return {
				title: `Zerobyte ${backupName} completed with warnings`,
				body: bodyLines.filter(Boolean).join("\n"),
			};
		}

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
