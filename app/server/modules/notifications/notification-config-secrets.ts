import { cryptoUtils, type SecretTransformer } from "~/server/utils/crypto";
import type { NotificationConfig } from "~/schemas/notifications";
import {
	prepareSecretConfigUpdate,
	redactConfigSecrets,
	secretAccessor,
	transformConfigSecrets,
	type ConfigSecretPolicy,
} from "~/server/utils/config-secret-policy";
import { sealNewSecret } from "~/server/utils/stored-secret";

type NotificationConfigFor<TType extends NotificationConfig["type"]> = Extract<NotificationConfig, { type: TType }>;

const emailPolicy: ConfigSecretPolicy<NotificationConfigFor<"email">> = {
	secrets: [
		secretAccessor(
			(config) => config.password,
			(config, password) => ({ ...config, password }),
		),
	],
	sameAuthority: (stored, submitted) =>
		stored.smtpHost === submitted.smtpHost &&
		stored.smtpPort === submitted.smtpPort &&
		stored.useTLS === submitted.useTLS &&
		stored.username === submitted.username,
};

const slackPolicy: ConfigSecretPolicy<NotificationConfigFor<"slack">> = {
	secrets: [
		secretAccessor(
			(config) => config.webhookUrl,
			(config, webhookUrl) => ({ ...config, webhookUrl }),
		),
	],
	sameAuthority: () => true,
};

const discordPolicy: ConfigSecretPolicy<NotificationConfigFor<"discord">> = {
	secrets: [
		secretAccessor(
			(config) => config.webhookUrl,
			(config, webhookUrl) => ({ ...config, webhookUrl }),
		),
	],
	sameAuthority: () => true,
};

const gotifyPolicy: ConfigSecretPolicy<NotificationConfigFor<"gotify">> = {
	secrets: [
		secretAccessor(
			(config) => config.token,
			(config, token) => ({ ...config, token }),
		),
	],
	sameAuthority: (stored, submitted) => stored.serverUrl === submitted.serverUrl,
};

const ntfyPolicy: ConfigSecretPolicy<NotificationConfigFor<"ntfy">> = {
	secrets: [
		secretAccessor(
			(config) => config.password,
			(config, password) => ({ ...config, password }),
		),
		secretAccessor(
			(config) => config.accessToken,
			(config, accessToken) => ({ ...config, accessToken }),
		),
	],
	sameAuthority: (stored, submitted) =>
		stored.serverUrl === submitted.serverUrl &&
		stored.topic === submitted.topic &&
		stored.username === submitted.username,
};

const pushoverPolicy: ConfigSecretPolicy<NotificationConfigFor<"pushover">> = {
	secrets: [
		secretAccessor(
			(config) => config.apiToken,
			(config, apiToken) => ({ ...config, apiToken }),
		),
	],
	sameAuthority: (stored, submitted) => stored.userKey === submitted.userKey,
};

const telegramPolicy: ConfigSecretPolicy<NotificationConfigFor<"telegram">> = {
	secrets: [
		secretAccessor(
			(config) => config.botToken,
			(config, botToken) => ({ ...config, botToken }),
		),
	],
	sameAuthority: (stored, submitted) => stored.chatId === submitted.chatId,
};

const customPolicy: ConfigSecretPolicy<NotificationConfigFor<"custom">> = {
	secrets: [
		secretAccessor(
			(config) => config.shoutrrrUrl,
			(config, shoutrrrUrl) => ({ ...config, shoutrrrUrl }),
		),
	],
	sameAuthority: () => true,
};

const genericPolicy: ConfigSecretPolicy<NotificationConfigFor<"generic">> = {
	secrets: [],
	sameAuthority: () => true,
};

export const mapNotificationConfigSecrets = async (config: NotificationConfig, transform: SecretTransformer) => {
	switch (config.type) {
		case "email":
			return await transformConfigSecrets(config, emailPolicy, transform);
		case "slack":
			return await transformConfigSecrets(config, slackPolicy, transform);
		case "discord":
			return await transformConfigSecrets(config, discordPolicy, transform);
		case "gotify":
			return await transformConfigSecrets(config, gotifyPolicy, transform);
		case "ntfy":
			return await transformConfigSecrets(config, ntfyPolicy, transform);
		case "pushover":
			return await transformConfigSecrets(config, pushoverPolicy, transform);
		case "telegram":
			return await transformConfigSecrets(config, telegramPolicy, transform);
		case "custom":
			return await transformConfigSecrets(config, customPolicy, transform);
		case "generic":
			return await transformConfigSecrets(config, genericPolicy, transform);
	}
};

export const encryptNotificationConfig = async (config: NotificationConfig) => {
	return await mapNotificationConfigSecrets(config, sealNewSecret);
};

export const decryptNotificationConfig = async (config: NotificationConfig) => {
	return await mapNotificationConfigSecrets(config, cryptoUtils.resolveSecret);
};

export const redactNotificationConfig = (config: NotificationConfig): NotificationConfig => {
	switch (config.type) {
		case "email":
			return redactConfigSecrets(config, emailPolicy);
		case "slack":
			return redactConfigSecrets(config, slackPolicy);
		case "discord":
			return redactConfigSecrets(config, discordPolicy);
		case "gotify":
			return redactConfigSecrets(config, gotifyPolicy);
		case "ntfy":
			return redactConfigSecrets(config, ntfyPolicy);
		case "pushover":
			return redactConfigSecrets(config, pushoverPolicy);
		case "telegram":
			return redactConfigSecrets(config, telegramPolicy);
		case "custom":
			return redactConfigSecrets(config, customPolicy);
		case "generic":
			return redactConfigSecrets(config, genericPolicy);
	}
};

export const prepareNotificationConfigUpdate = async (stored: NotificationConfig, submitted: NotificationConfig) => {
	switch (submitted.type) {
		case "email":
			return await prepareSecretConfigUpdate(
				stored.type === "email" ? stored : undefined,
				submitted,
				emailPolicy,
			);
		case "slack":
			return await prepareSecretConfigUpdate(
				stored.type === "slack" ? stored : undefined,
				submitted,
				slackPolicy,
			);
		case "discord":
			return await prepareSecretConfigUpdate(
				stored.type === "discord" ? stored : undefined,
				submitted,
				discordPolicy,
			);
		case "gotify":
			return await prepareSecretConfigUpdate(
				stored.type === "gotify" ? stored : undefined,
				submitted,
				gotifyPolicy,
			);
		case "ntfy":
			return await prepareSecretConfigUpdate(stored.type === "ntfy" ? stored : undefined, submitted, ntfyPolicy);
		case "pushover":
			return await prepareSecretConfigUpdate(
				stored.type === "pushover" ? stored : undefined,
				submitted,
				pushoverPolicy,
			);
		case "telegram":
			return await prepareSecretConfigUpdate(
				stored.type === "telegram" ? stored : undefined,
				submitted,
				telegramPolicy,
			);
		case "custom":
			return await prepareSecretConfigUpdate(
				stored.type === "custom" ? stored : undefined,
				submitted,
				customPolicy,
			);
		case "generic":
			return await prepareSecretConfigUpdate(
				stored.type === "generic" ? stored : undefined,
				submitted,
				genericPolicy,
			);
	}
};
