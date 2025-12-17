import { type } from "arktype";
import { describeRoute, resolver } from "hono-openapi";
import { NOTIFICATION_TYPES, notificationConfigSchema } from "~/schemas/notifications";

/**
 * Notification Destination Schema
 */
export const notificationDestinationSchema = type({
	id: "number",
	name: "string",
	enabled: "boolean",
	type: type.valueOf(NOTIFICATION_TYPES),
	config: notificationConfigSchema,
	createdAt: "number",
	updatedAt: "number",
});

export type NotificationDestinationDto = typeof notificationDestinationSchema.infer;

/**
 * List all notification destinations
 */
export const listDestinationsResponse = notificationDestinationSchema.array();
export type ListDestinationsDto = typeof listDestinationsResponse.infer;

export const listDestinationsDto = describeRoute({
	description: "List all notification destinations",
	tags: ["Notifications"],
	operationId: "listNotificationDestinations",
	responses: {
		200: {
			description: "A list of notification destinations",
			content: {
				"application/json": {
					schema: resolver(listDestinationsResponse),
				},
			},
		},
	},
});

/**
 * Create a new notification destination
 */
export const createDestinationBody = type({
	name: "string",
	config: notificationConfigSchema,
});

export const createDestinationResponse = notificationDestinationSchema;
export type CreateDestinationDto = typeof createDestinationResponse.infer;

export const createDestinationDto = describeRoute({
	description: "Create a new notification destination",
	operationId: "createNotificationDestination",
	tags: ["Notifications"],
	responses: {
		201: {
			description: "Notification destination created successfully",
			content: {
				"application/json": {
					schema: resolver(createDestinationResponse),
				},
			},
		},
	},
});

/**
 * Get a single notification destination
 */
export const getDestinationResponse = notificationDestinationSchema;
export type GetDestinationDto = typeof getDestinationResponse.infer;

export const getDestinationDto = describeRoute({
	description: "Get a notification destination by ID",
	operationId: "getNotificationDestination",
	tags: ["Notifications"],
	responses: {
		200: {
			description: "Notification destination details",
			content: {
				"application/json": {
					schema: resolver(getDestinationResponse),
				},
			},
		},
		404: {
			description: "Notification destination not found",
		},
	},
});

/**
 * Update a notification destination
 */
export const updateDestinationBody = type({
	"name?": "string",
	"enabled?": "boolean",
	"config?": notificationConfigSchema,
});

export const updateDestinationResponse = notificationDestinationSchema;
export type UpdateDestinationDto = typeof updateDestinationResponse.infer;

export const updateDestinationDto = describeRoute({
	description: "Update a notification destination",
	operationId: "updateNotificationDestination",
	tags: ["Notifications"],
	responses: {
		200: {
			description: "Notification destination updated successfully",
			content: {
				"application/json": {
					schema: resolver(updateDestinationResponse),
				},
			},
		},
		404: {
			description: "Notification destination not found",
		},
	},
});

/**
 * Delete a notification destination
 */
export const deleteDestinationResponse = type({
	message: "string",
});
export type DeleteDestinationDto = typeof deleteDestinationResponse.infer;

export const deleteDestinationDto = describeRoute({
	description: "Delete a notification destination",
	operationId: "deleteNotificationDestination",
	tags: ["Notifications"],
	responses: {
		200: {
			description: "Notification destination deleted successfully",
			content: {
				"application/json": {
					schema: resolver(deleteDestinationResponse),
				},
			},
		},
		404: {
			description: "Notification destination not found",
		},
	},
});

/**
 * Test a notification destination
 */
export const testDestinationResponse = type({
	success: "boolean",
});
export type TestDestinationDto = typeof testDestinationResponse.infer;

export const testDestinationDto = describeRoute({
	description: "Test a notification destination by sending a test message",
	operationId: "testNotificationDestination",
	tags: ["Notifications"],
	responses: {
		200: {
			description: "Test notification sent successfully",
			content: {
				"application/json": {
					schema: resolver(testDestinationResponse),
				},
			},
		},
		404: {
			description: "Notification destination not found",
		},
		409: {
			description: "Cannot test disabled destination",
		},
		500: {
			description: "Failed to send test notification",
		},
	},
});

/**
 * Backup Schedule Notification Assignment Schema
 */
export const scheduleNotificationAssignmentSchema = type({
	scheduleId: "number",
	destinationId: "number",
	notifyOnStart: "boolean",
	notifyOnSuccess: "boolean",
	notifyOnWarning: "boolean",
	notifyOnFailure: "boolean",
	createdAt: "number",
	destination: notificationDestinationSchema,
});

export type ScheduleNotificationAssignmentDto = typeof scheduleNotificationAssignmentSchema.infer;

/**
 * Get notifications for a backup schedule
 */
export const getScheduleNotificationsResponse = scheduleNotificationAssignmentSchema.array();
export type GetScheduleNotificationsDto = typeof getScheduleNotificationsResponse.infer;

export const getScheduleNotificationsDto = describeRoute({
	description: "Get notification assignments for a backup schedule",
	operationId: "getScheduleNotifications",
	tags: ["Backups", "Notifications"],
	responses: {
		200: {
			description: "List of notification assignments for the schedule",
			content: {
				"application/json": {
					schema: resolver(getScheduleNotificationsResponse),
				},
			},
		},
	},
});

/**
 * Update notifications for a backup schedule
 */
export const updateScheduleNotificationsBody = type({
	assignments: type({
		destinationId: "number",
		notifyOnStart: "boolean",
		notifyOnSuccess: "boolean",
		notifyOnWarning: "boolean",
		notifyOnFailure: "boolean",
	}).array(),
});

export const updateScheduleNotificationsResponse = scheduleNotificationAssignmentSchema.array();
export type UpdateScheduleNotificationsDto = typeof updateScheduleNotificationsResponse.infer;

export const updateScheduleNotificationsDto = describeRoute({
	description: "Update notification assignments for a backup schedule",
	operationId: "updateScheduleNotifications",
	tags: ["Backups", "Notifications"],
	responses: {
		200: {
			description: "Notification assignments updated successfully",
			content: {
				"application/json": {
					schema: resolver(updateScheduleNotificationsResponse),
				},
			},
		},
	},
});
