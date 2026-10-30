import type { GetDestinationDto } from "./notifications.dto";
import type { NotificationDestination } from "~/server/db/schema";
import { redactNotificationConfig } from "./notification-config-secrets";

export const presentNotificationDestination = (destination: NotificationDestination): GetDestinationDto => ({
	id: destination.id,
	name: destination.name,
	enabled: destination.enabled,
	status: destination.status,
	lastChecked: destination.lastChecked,
	lastError: destination.lastError,
	type: destination.type,
	config: redactNotificationConfig(destination.config),
	createdAt: destination.createdAt,
	updatedAt: destination.updatedAt,
});
