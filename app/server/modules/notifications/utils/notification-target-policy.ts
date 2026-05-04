import { BadRequestError } from "http-errors-enhanced";
import type { NotificationConfig } from "~/schemas/notifications";

type ShoutrrrTargetGetter = (url: URL, scheme: string) => string | null;

const getSearchParam = (url: URL, name: string) => {
	const lowerName = name.toLowerCase();
	for (const [key, value] of url.searchParams.entries()) {
		if (key.toLowerCase() === lowerName) {
			return value;
		}
	}
	return null;
};

const getHttpTarget = (url: URL, useHttp: boolean) => `${useHttp ? "http" : "https"}://${url.host}`;
const getSchemeTarget = (url: URL, scheme: string, defaultHost?: string) => {
	const host = url.host || defaultHost;
	return host ? `${scheme}://${host}` : null;
};

const fixedProviderShoutrrrSchemes = new Set([
	"discord",
	"googlechat",
	"hangouts",
	"ifttt",
	"join",
	"logger",
	"notifiarr",
	"pushover",
	"pushbullet",
	"slack",
	"teams",
	"telegram",
	"twilio",
	"wecom",
]);

const customShoutrrrTargets: Record<string, ShoutrrrTargetGetter> = {
	bark: (url) => getHttpTarget(url, getSearchParam(url, "scheme") === "http"),
	generic: (url) => getHttpTarget(url, getSearchParam(url, "disabletls") === "yes"),
	gotify: (url) => getHttpTarget(url, getSearchParam(url, "DisableTLS") === "true"),
	lark: (url) => getHttpTarget(url, false),
	matrix: (url) => getHttpTarget(url, getSearchParam(url, "disableTLS") === "yes"),
	mattermost: (url) => getHttpTarget(url, getSearchParam(url, "disabletls") === "yes"),
	mqtt: (url, scheme) => getSchemeTarget(url, scheme, "localhost"),
	mqtts: (url, scheme) => getSchemeTarget(url, scheme, "localhost"),
	ntfy: (url) => {
		if (url.hostname === "ntfy.sh") {
			return null;
		}

		return getHttpTarget(url, getSearchParam(url, "scheme") === "http");
	},
	opsgenie: (url) => getHttpTarget(url, false),
	pagerduty: (url) => getHttpTarget(url, false),
	rocketchat: (url) => getHttpTarget(url, false),
	signal: (url) => getHttpTarget(url, getSearchParam(url, "disabletls") === "yes"),
	smtp: (url) => getSchemeTarget(url, "smtp"),
	zulip: (url) => getHttpTarget(url, false),
};

const getComparableTarget = (target: string) => {
	if (!URL.canParse(target)) {
		return null;
	}

	const url = new URL(target);
	if (url.origin !== "null") {
		return url.origin;
	}

	return url.host ? `${url.protocol}//${url.host}` : null;
};

const isAllowedNotificationTarget = (target: string, allowedTargets: readonly string[]) => {
	const comparableTarget = getComparableTarget(target);
	return (
		comparableTarget !== null &&
		allowedTargets.some((allowedTarget) => getComparableTarget(allowedTarget) === comparableTarget)
	);
};

const assertTargetAllowed = (target: string, allowedTargets: readonly string[]) => {
	if (!isAllowedNotificationTarget(target, allowedTargets)) {
		throw new BadRequestError(
			`Notification webhook URL origin is not allowed. Add ${getComparableTarget(target) ?? target} to WEBHOOK_ALLOWED_ORIGINS.`,
		);
	}
};

const getCustomShoutrrrTarget = (shoutrrrUrl: string) => {
	if (!URL.canParse(shoutrrrUrl)) {
		throw new BadRequestError("Invalid custom Shoutrrr URL");
	}

	const parsedUrl = new URL(shoutrrrUrl);
	const scheme = parsedUrl.protocol.slice(0, -1).toLowerCase();

	if (scheme === "generic+http" || scheme === "generic+https") {
		return `${scheme.slice("generic+".length)}://${parsedUrl.host}`;
	}

	if (fixedProviderShoutrrrSchemes.has(scheme)) {
		return null;
	}

	const getTarget = customShoutrrrTargets[scheme];
	if (!getTarget) {
		throw new BadRequestError(`Custom Shoutrrr scheme "${scheme}" is not supported by the SSRF policy.`);
	}

	return getTarget(parsedUrl, scheme);
};

const getNotificationTarget = (notificationConfig: NotificationConfig) => {
	switch (notificationConfig.type) {
		case "email": {
			const smtpTarget = new URL("smtp://placeholder");
			smtpTarget.hostname = notificationConfig.smtpHost;
			smtpTarget.port = String(notificationConfig.smtpPort);
			return `${smtpTarget.protocol}//${smtpTarget.host}`;
		}
		case "slack":
		case "discord":
		case "pushover":
		case "telegram":
			return null;
		case "generic":
			return notificationConfig.url;
		case "gotify":
			return notificationConfig.serverUrl;
		case "ntfy":
			return notificationConfig.serverUrl ?? null;
		case "custom":
			return getCustomShoutrrrTarget(notificationConfig.shoutrrrUrl);
		default: {
			const _exhaustive: never = notificationConfig;
			throw new BadRequestError(
				`Unsupported notification type "${(_exhaustive as NotificationConfig).type}" for the SSRF policy.`,
			);
		}
	}
};

export const assertNotificationTargetAllowed = (
	notificationConfig: NotificationConfig,
	allowedTargets: readonly string[],
) => {
	const target = getNotificationTarget(notificationConfig);
	if (!target) {
		return;
	}

	assertTargetAllowed(target, allowedTargets);
};
