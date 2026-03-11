import { z } from "zod";

export const NOTIFICATION_TYPES = {
	email: "email",
	slack: "slack",
	discord: "discord",
	gotify: "gotify",
	ntfy: "ntfy",
	pushover: "pushover",
	telegram: "telegram",
	generic: "generic",
	custom: "custom",
} as const;

export type NotificationType = keyof typeof NOTIFICATION_TYPES;

export const emailNotificationConfigSchema = z.object({
	type: z.literal("email"),
	smtpHost: z.string().min(1),
	smtpPort: z.number().int().min(1).max(65535),
	username: z.string().optional(),
	password: z.string().optional(),
	from: z.string().min(1),
	fromName: z.string().optional(),
	to: z.array(z.string()),
	useTLS: z.boolean(),
});

export const slackNotificationConfigSchema = z.object({
	type: z.literal("slack"),
	webhookUrl: z.string().min(1),
	channel: z.string().optional(),
	username: z.string().optional(),
	iconEmoji: z.string().optional(),
});

export const discordNotificationConfigSchema = z.object({
	type: z.literal("discord"),
	webhookUrl: z.string().min(1),
	username: z.string().optional(),
	avatarUrl: z.string().optional(),
	threadId: z.string().optional(),
});

export const gotifyNotificationConfigSchema = z.object({
	type: z.literal("gotify"),
	serverUrl: z.string().min(1),
	token: z.string().min(1),
	path: z.string().optional(),
	priority: z.number().min(0).max(10),
});

export const ntfyNotificationConfigSchema = z.object({
	type: z.literal("ntfy"),
	serverUrl: z.string().optional(),
	topic: z.string().min(1),
	priority: z.enum(["max", "high", "default", "low", "min"]),
	username: z.string().optional(),
	password: z.string().optional(),
	accessToken: z.string().optional(),
});

export const pushoverNotificationConfigSchema = z.object({
	type: z.literal("pushover"),
	userKey: z.string().min(1),
	apiToken: z.string().min(1),
	devices: z.string().optional(),
	priority: z.union([z.literal(-1), z.literal(0), z.literal(1)]),
});

export const telegramNotificationConfigSchema = z.object({
	type: z.literal("telegram"),
	botToken: z.string().min(1),
	chatId: z.string().min(1),
	threadId: z.string().optional(),
});

export const genericNotificationConfigSchema = z.object({
	type: z.literal("generic"),
	url: z.string().min(1),
	method: z.enum(["GET", "POST"]),
	contentType: z.string().optional(),
	headers: z.array(z.string()).optional(),
	useJson: z.boolean().optional(),
	titleKey: z.string().optional(),
	messageKey: z.string().optional(),
});

export const customNotificationConfigSchema = z.object({
	type: z.literal("custom"),
	shoutrrrUrl: z.string().min(1),
});

export const notificationConfigSchemaBase = z.discriminatedUnion("type", [
	emailNotificationConfigSchema,
	slackNotificationConfigSchema,
	discordNotificationConfigSchema,
	gotifyNotificationConfigSchema,
	ntfyNotificationConfigSchema,
	pushoverNotificationConfigSchema,
	telegramNotificationConfigSchema,
	genericNotificationConfigSchema,
	customNotificationConfigSchema,
]);

export const notificationConfigSchema = notificationConfigSchemaBase;

export type NotificationConfig = z.infer<typeof notificationConfigSchema>;

export const NOTIFICATION_EVENTS = {
	start: "start",
	success: "success",
	failure: "failure",
	warning: "warning",
} as const;

export type NotificationEvent = keyof typeof NOTIFICATION_EVENTS;
