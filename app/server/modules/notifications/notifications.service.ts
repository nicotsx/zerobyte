import { eq, and } from "drizzle-orm";
import { BadRequestError, ConflictError, InternalServerError, NotFoundError } from "http-errors-enhanced";
import { db } from "../../db/db";
import {
	notificationDestinationsTable,
	backupScheduleNotificationsTable,
	type NotificationDestination,
} from "../../db/schema";
import { logger, sanitizeSensitiveData } from "@zerobyte/core/node";
import { sendNotification } from "../../utils/shoutrrr";
import { buildShoutrrrUrl } from "./builders";
import { notificationConfigSchema, type NotificationConfig, type NotificationEvent } from "~/schemas/notifications";
import type { ResticBackupRunSummaryDto } from "@zerobyte/core/restic";
import { toMessage } from "../../utils/errors";
import { config as serverConfig } from "~/server/core/config";
import { getOrganizationId } from "~/server/core/request-context";
import { decryptNotificationConfig, encryptNotificationConfig } from "./notification-config-secrets";
import { serverEvents } from "~/server/core/events";
import { assertNotificationTargetAllowed } from "./utils/notification-target-policy";
import { normalizeRequiredName } from "~/server/utils/names";
import {
	buildBackupNotificationMessage,
	renderNotificationMessage,
	buildMirrorFailureNotificationMessage,
	buildTestNotificationMessage,
	type NotificationMessage,
} from "./notification-message";
import { defaultNotificationTemplates, type NotificationTemplateSet } from "~/lib/notification-templates/catalog";
import { notificationTemplateSetSchema, notificationTemplateDraftSchema } from "~/lib/notification-templates/schema";
import { notificationTemplateSamples } from "~/lib/notification-templates/samples";
import type { z } from "zod";

const parseTemplates = (templates: NotificationTemplateSet) => {
	const result = notificationTemplateSetSchema.safeParse(templates);
	if (!result.success) throw new BadRequestError(result.error.issues.map((issue) => issue.message).join("; "));

	return result.data;
};

const MAX_DELIVERY_ERROR_LENGTH = 2048;

const formatDeliveryError = (error?: string) => {
	return sanitizeSensitiveData(error ?? "Unknown error").slice(0, MAX_DELIVERY_ERROR_LENGTH);
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

const createDestination = async (
	name: string,
	config: NotificationConfig,
	templates: NotificationTemplateSet = defaultNotificationTemplates,
) => {
	const organizationId = getOrganizationId();
	const normalizedName = normalizeRequiredName(name);
	const normalizedTemplates = parseTemplates(templates);

	if (normalizedName === null) {
		throw new BadRequestError("Name cannot be empty");
	}

	assertNotificationTargetAllowed(config, serverConfig.webhookAllowedOrigins);

	const encryptedConfig = await encryptNotificationConfig(config);

	const [created] = await db
		.insert(notificationDestinationsTable)
		.values({
			name: normalizedName,
			type: config.type,
			config: encryptedConfig,
			templates: normalizedTemplates,
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
	updates: { name?: string; enabled?: boolean; config?: NotificationConfig; templates?: NotificationTemplateSet },
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
		const normalizedName = normalizeRequiredName(updates.name);
		if (normalizedName === null) {
			throw new BadRequestError("Name cannot be empty");
		}
		updateData.name = normalizedName;
	}

	if (updates.enabled !== undefined) {
		updateData.enabled = updates.enabled;
	}

	if (updates.templates !== undefined) {
		updateData.templates = parseTemplates(updates.templates);
	}

	if (updates.config !== undefined) {
		const newConfigResult = notificationConfigSchema.safeParse(updates.config);
		if (!newConfigResult.success) {
			throw new BadRequestError("Invalid notification configuration");
		}
		const newConfig = newConfigResult.data;
		const resolvedConfig = await decryptNotificationConfig(newConfig);
		const existingConfig = await decryptNotificationConfig(existing.config);

		if (JSON.stringify(resolvedConfig) !== JSON.stringify(existingConfig)) {
			assertNotificationTargetAllowed(resolvedConfig, serverConfig.webhookAllowedOrigins);

			const encryptedConfig = await encryptNotificationConfig(newConfig);
			updateData.config = encryptedConfig;
			updateData.type = newConfig.type;
		}
	}

	const [updated] = await db
		.update(notificationDestinationsTable)
		.set(updateData)
		.where(
			and(
				eq(notificationDestinationsTable.id, id),
				eq(notificationDestinationsTable.organizationId, organizationId),
			),
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
			and(
				eq(notificationDestinationsTable.id, id),
				eq(notificationDestinationsTable.organizationId, organizationId),
			),
		);
};

const updateDeliveryStatus = async (destinationId: number, result: { success: boolean; error?: string }) => {
	const [updated] = await db
		.update(notificationDestinationsTable)
		.set({
			status: result.success ? "healthy" : "error",
			lastChecked: Date.now(),
			lastError: result.success ? null : formatDeliveryError(result.error),
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

const testDestination = async (id: number, draft?: z.infer<typeof notificationTemplateDraftSchema>) => {
	const destination = await getDestination(id);
	if (!destination.enabled) throw new ConflictError("Cannot test disabled destination");

	const testMessage = buildTestNotificationMessage(destination.name);
	let message = testMessage;
	let templates = destination.templates;

	if (draft !== undefined) {
		const parsedDraft = notificationTemplateDraftSchema.safeParse(draft);
		if (!parsedDraft.success) {
			throw new BadRequestError(parsedDraft.error.issues.map((issue) => issue.message).join("; "));
		}

		const { key, template } = parsedDraft.data;

		message = {
			key,
			context: { ...notificationTemplateSamples[key], ...testMessage.context },
		};
		templates = { ...destination.templates, [key]: template };
	}

	let result: Awaited<ReturnType<typeof sendNotification>>;

	try {
		const decryptedConfig = await decryptNotificationConfig(destination.config);
		assertNotificationTargetAllowed(decryptedConfig, serverConfig.webhookAllowedOrigins);

		const shoutrrrUrl = buildShoutrrrUrl(decryptedConfig);

		logger.debug("Testing notification with Shoutrrr URL:", shoutrrrUrl);

		result = await sendNotification({
			shoutrrrUrl,
			...renderNotificationMessage(message, shoutrrrUrl, templates),
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

	await db
		.delete(backupScheduleNotificationsTable)
		.where(eq(backupScheduleNotificationsTable.scheduleId, scheduleId));

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

const sendScheduleNotification = async (
	scheduleId: number,
	event: NotificationEvent,
	buildMessage: () => NotificationMessage,
	operation: "backup" | "mirror sync",
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
			logger.debug(`No notification destinations configured for ${operation} ${scheduleId} event ${event}`);
			return;
		}

		const message = buildMessage();

		for (const assignment of relevantAssignments) {
			try {
				const decryptedConfig = await decryptNotificationConfig(assignment.destination.config);
				assertNotificationTargetAllowed(decryptedConfig, serverConfig.webhookAllowedOrigins);
				const shoutrrrUrl = buildShoutrrrUrl(decryptedConfig);

				const result = await sendNotification({
					shoutrrrUrl,
					...renderNotificationMessage(message, shoutrrrUrl, assignment.destination.templates),
				});
				await updateDeliveryStatus(assignment.destination.id, result);

				if (result.success) {
					logger.info(
						`Notification sent successfully to ${assignment.destination.name} for ${operation} ${scheduleId} event ${event}`,
					);
				} else {
					logger.error(
						`Failed to send notification to ${assignment.destination.name} for ${operation} ${scheduleId}: ${result.error}`,
					);
				}
			} catch (error) {
				await updateDeliveryStatus(assignment.destination.id, { success: false, error: toMessage(error) });
				logger.error(
					`Error sending notification to ${assignment.destination.name} for ${operation} ${scheduleId}: ${toMessage(error)}`,
				);
			}
		}
	} catch (error) {
		logger.error(`Error processing ${operation} notifications for schedule ${scheduleId}: ${toMessage(error)}`);
	}
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
	return sendScheduleNotification(scheduleId, event, () => buildBackupNotificationMessage(event, context), "backup");
};

const sendMirrorSyncFailureNotification = async (
	scheduleId: number,
	context: {
		scheduleName: string;
		sourceRepositoryName: string;
		mirrorRepositoryName: string;
		error: string;
	},
) => {
	return sendScheduleNotification(
		scheduleId,
		"failure",
		() => buildMirrorFailureNotificationMessage(context),
		"mirror sync",
	);
};

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
	sendMirrorSyncFailureNotification,
};
