import { type } from "arktype";

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

export const emailNotificationConfigSchema = type({
	type: "'email'",
	smtpHost: "string",
	smtpPort: "1 <= number <= 65535",
	username: "string?",
	password: "string?",
	from: "string",
	to: "string[]",
	useTLS: "boolean",
});

export const slackNotificationConfigSchema = type({
	type: "'slack'",
	webhookUrl: "string",
	channel: "string?",
	username: "string?",
	iconEmoji: "string?",
});

export const discordNotificationConfigSchema = type({
	type: "'discord'",
	webhookUrl: "string",
	username: "string?",
	avatarUrl: "string?",
	threadId: "string?",
});

export const gotifyNotificationConfigSchema = type({
	type: "'gotify'",
	serverUrl: "string",
	token: "string",
	path: "string?",
	priority: "0 <= number <= 10",
});

export const ntfyNotificationConfigSchema = type({
	type: "'ntfy'",
	serverUrl: "string?",
	topic: "string",
	priority: "'max' | 'high' | 'default' | 'low' | 'min'",
	username: "string?",
	password: "string?",
	accessToken: "string?",
});

export const pushoverNotificationConfigSchema = type({
	type: "'pushover'",
	userKey: "string",
	apiToken: "string",
	devices: "string?",
	priority: "-1 | 0 | 1",
});

export const telegramNotificationConfigSchema = type({
	type: "'telegram'",
	botToken: "string",
	chatId: "string",
	threadId: "string?",
});

export const genericNotificationConfigSchema = type({
	type: "'generic'",
	url: "string",
	method: "'GET' | 'POST'",
	contentType: "string?",
	headers: "string[]?",
	useJson: "boolean?",
	titleKey: "string?",
	messageKey: "string?",
});

export const customNotificationConfigSchema = type({
	type: "'custom'",
	shoutrrrUrl: "string",
});

export const notificationConfigSchemaBase = emailNotificationConfigSchema
	.or(slackNotificationConfigSchema)
	.or(discordNotificationConfigSchema)
	.or(gotifyNotificationConfigSchema)
	.or(ntfyNotificationConfigSchema)
	.or(pushoverNotificationConfigSchema)
	.or(telegramNotificationConfigSchema)
	.or(genericNotificationConfigSchema)
	.or(customNotificationConfigSchema);

export const notificationConfigSchema = notificationConfigSchemaBase.onUndeclaredKey("delete");

export type NotificationConfig = typeof notificationConfigSchema.infer;

export const NOTIFICATION_EVENTS = {
	start: "start",
	success: "success",
	failure: "failure",
	warning: "warning",
} as const;

export type NotificationEvent = keyof typeof NOTIFICATION_EVENTS;
