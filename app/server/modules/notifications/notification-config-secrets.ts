import { cryptoUtils, transformOptionalSecret, type SecretTransformer } from "~/server/utils/crypto";
import type { NotificationConfig } from "~/schemas/notifications";

export const mapNotificationConfigSecrets = async (config: NotificationConfig, transformSecret: SecretTransformer) => {
	switch (config.type) {
		case "email":
			return {
				...config,
				password: await transformOptionalSecret(config.password, transformSecret),
			};
		case "slack":
			return {
				...config,
				webhookUrl: await transformSecret(config.webhookUrl),
			};
		case "discord":
			return {
				...config,
				webhookUrl: await transformSecret(config.webhookUrl),
			};
		case "gotify":
			return {
				...config,
				token: await transformSecret(config.token),
			};
		case "ntfy":
			return {
				...config,
				password: await transformOptionalSecret(config.password, transformSecret),
				accessToken: await transformOptionalSecret(config.accessToken, transformSecret),
			};
		case "pushover":
			return {
				...config,
				apiToken: await transformSecret(config.apiToken),
			};
		case "telegram":
			return {
				...config,
				botToken: await transformSecret(config.botToken),
			};
		case "custom":
			return {
				...config,
				shoutrrrUrl: await transformSecret(config.shoutrrrUrl),
			};
		case "generic":
			return config;
	}
};

export const encryptNotificationConfig = async (config: NotificationConfig) => {
	return await mapNotificationConfigSecrets(config, cryptoUtils.sealSecret);
};

export const decryptNotificationConfig = async (config: NotificationConfig) => {
	return await mapNotificationConfigSecrets(config, cryptoUtils.resolveSecret);
};
