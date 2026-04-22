import { z } from "zod";
import { describeRoute, resolver } from "hono-openapi";
import { NOTIFICATION_TYPES, notificationConfigSchema } from "~/schemas/notifications";

const notificationDestinationSchema = z.object({
	id: z.number(),
	name: z.string(),
	enabled: z.boolean(),
	type: z.enum(NOTIFICATION_TYPES),
	config: notificationConfigSchema,
	createdAt: z.number(),
	updatedAt: z.number(),
});

const listDestinationsResponse = notificationDestinationSchema.array();
export type ListDestinationsDto = z.infer<typeof listDestinationsResponse>;

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

export const createDestinationBody = z.object({
	name: z.string(),
	config: notificationConfigSchema,
});

const createDestinationResponse = notificationDestinationSchema;
export type CreateDestinationDto = z.infer<typeof createDestinationResponse>;

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

const getDestinationResponse = notificationDestinationSchema;
export type GetDestinationDto = z.infer<typeof getDestinationResponse>;

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

export const updateDestinationBody = z.object({
	name: z.string().optional(),
	enabled: z.boolean().optional(),
	config: notificationConfigSchema.optional(),
});

const updateDestinationResponse = notificationDestinationSchema;
export type UpdateDestinationDto = z.infer<typeof updateDestinationResponse>;

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

const deleteDestinationResponse = z.object({
	message: z.string(),
});
export type DeleteDestinationDto = z.infer<typeof deleteDestinationResponse>;

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

const testDestinationResponse = z.object({
	success: z.boolean(),
});
export type TestDestinationDto = z.infer<typeof testDestinationResponse>;

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

const scheduleNotificationAssignmentSchema = z.object({
	scheduleId: z.number(),
	destinationId: z.number(),
	notifyOnStart: z.boolean(),
	notifyOnSuccess: z.boolean(),
	notifyOnWarning: z.boolean(),
	notifyOnFailure: z.boolean(),
	createdAt: z.number(),
	destination: notificationDestinationSchema,
});

const getScheduleNotificationsResponse = scheduleNotificationAssignmentSchema.array();
export type GetScheduleNotificationsDto = z.infer<typeof getScheduleNotificationsResponse>;

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

export const updateScheduleNotificationsBody = z.object({
	assignments: z
		.object({
			destinationId: z.number(),
			notifyOnStart: z.boolean(),
			notifyOnSuccess: z.boolean(),
			notifyOnWarning: z.boolean(),
			notifyOnFailure: z.boolean(),
		})
		.array(),
});

const updateScheduleNotificationsResponse = scheduleNotificationAssignmentSchema.array();
export type UpdateScheduleNotificationsDto = z.infer<typeof updateScheduleNotificationsResponse>;

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
