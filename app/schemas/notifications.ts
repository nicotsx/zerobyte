import { type } from "arktype";

export const NOTIFICATION_TYPES = {
	email: "email",
	slack: "slack",
	discord: "discord",
	gotify: "gotify",
	ntfy: "ntfy",
	pushover: "pushover",
	telegram: "telegram",
	custom: "custom",
} as const;

export type NotificationType = keyof typeof NOTIFICATION_TYPES;

export const emailNotificationConfigShape = {
	type: "'email'",
	smtpHost: "string",
	smtpPort: "1 <= number <= 65535",
	username: "string?",
	password: "string?",
	from: "string",
	to: "string[]",
	useTLS: "boolean",
} as const;

export const emailNotificationConfigSchema = type(emailNotificationConfigShape);

export const slackNotificationConfigShape = {
	type: "'slack'",
	webhookUrl: "string",
	channel: "string?",
	username: "string?",
	iconEmoji: "string?",
} as const;

export const slackNotificationConfigSchema = type(slackNotificationConfigShape);

export const discordNotificationConfigShape = {
	type: "'discord'",
	webhookUrl: "string",
	username: "string?",
	avatarUrl: "string?",
	threadId: "string?",
} as const;

export const discordNotificationConfigSchema = type(discordNotificationConfigShape);

export const gotifyNotificationConfigShape = {
	type: "'gotify'",
	serverUrl: "string",
	token: "string",
	path: "string?",
	priority: "0 <= number <= 10",
} as const;

export const gotifyNotificationConfigSchema = type(gotifyNotificationConfigShape);

export const ntfyNotificationConfigShape = {
	type: "'ntfy'",
	serverUrl: "string?",
	topic: "string",
	priority: "'max' | 'high' | 'default' | 'low' | 'min'",
	username: "string?",
	password: "string?",
} as const;

export const ntfyNotificationConfigSchema = type(ntfyNotificationConfigShape);

export const pushoverNotificationConfigShape = {
	type: "'pushover'",
	userKey: "string",
	apiToken: "string",
	devices: "string?",
	priority: "-1 | 0 | 1",
} as const;

export const pushoverNotificationConfigSchema = type(pushoverNotificationConfigShape);

export const telegramNotificationConfigShape = {
	type: "'telegram'",
	botToken: "string",
	chatId: "string",
} as const;

export const telegramNotificationConfigSchema = type(telegramNotificationConfigShape);

export const customNotificationConfigShape = {
	type: "'custom'",
	shoutrrrUrl: "string",
} as const;

export const customNotificationConfigSchema = type(customNotificationConfigShape);

export const notificationConfigSchema = emailNotificationConfigSchema
	.or(slackNotificationConfigSchema)
	.or(discordNotificationConfigSchema)
	.or(gotifyNotificationConfigSchema)
	.or(ntfyNotificationConfigSchema)
	.or(pushoverNotificationConfigSchema)
	.or(telegramNotificationConfigSchema)
	.or(customNotificationConfigSchema);

export type NotificationConfig = typeof notificationConfigSchema.infer;

export const NOTIFICATION_CONFIG_SHAPES = {
	email: emailNotificationConfigShape,
	slack: slackNotificationConfigShape,
	discord: discordNotificationConfigShape,
	gotify: gotifyNotificationConfigShape,
	ntfy: ntfyNotificationConfigShape,
	pushover: pushoverNotificationConfigShape,
	telegram: telegramNotificationConfigShape,
	custom: customNotificationConfigShape,
} as const;

export const NOTIFICATION_EVENTS = {
	start: "start",
	success: "success",
	failure: "failure",
	warning: "warning",
} as const;

export type NotificationEvent = keyof typeof NOTIFICATION_EVENTS;
