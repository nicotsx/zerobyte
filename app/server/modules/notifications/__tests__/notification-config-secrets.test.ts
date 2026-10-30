import { afterEach, describe, expect, test, vi } from "vitest";
import { cryptoUtils } from "~/server/utils/crypto";
import { STORED_SECRET } from "~/server/utils/stored-secret";
import {
	mapNotificationConfigSecrets,
	prepareNotificationConfigUpdate,
	redactNotificationConfig,
} from "../notification-config-secrets";

afterEach(() => {
	vi.restoreAllMocks();
});

describe("mapNotificationConfigSecrets", () => {
	test("transforms only secret fields for a notification config", async () => {
		const transformed = await mapNotificationConfigSecrets(
			{
				type: "slack",
				webhookUrl: "https://hooks.slack.test/services/a/b/c",
				username: "zerobyte",
				iconEmoji: ":wave:",
			},
			async (value) => `sealed:${value}`,
		);

		expect(transformed).toEqual({
			type: "slack",
			webhookUrl: "sealed:https://hooks.slack.test/services/a/b/c",
			username: "zerobyte",
			iconEmoji: ":wave:",
		});
	});

	test("preserves optional undefined secrets", async () => {
		const transformed = await mapNotificationConfigSecrets(
			{
				type: "email",
				smtpHost: "smtp.example.com",
				smtpPort: 587,
				username: "ops",
				password: undefined,
				from: "ops@example.com",
				to: ["alerts@example.com"],
				useTLS: true,
			},
			async (value) => `sealed:${value}`,
		);

		expect(transformed).toEqual({
			type: "email",
			smtpHost: "smtp.example.com",
			smtpPort: 587,
			username: "ops",
			password: undefined,
			from: "ops@example.com",
			to: ["alerts@example.com"],
			useTLS: true,
		});
	});

	test("preserves ciphertext when an identical notification credential is re-entered", async () => {
		const actual = await vi.importActual<typeof import("~/server/utils/crypto")>("~/server/utils/crypto");
		vi.spyOn(cryptoUtils, "sealSecret").mockImplementation(actual.cryptoUtils.sealSecret);
		vi.spyOn(cryptoUtils, "resolveSecret").mockImplementation(actual.cryptoUtils.resolveSecret);

		const webhookUrl = "https://hooks.slack.test/services/a/b/c";
		const encryptedWebhookUrl = await actual.cryptoUtils.sealSecret(webhookUrl);
		const stored = { type: "slack" as const, webhookUrl: encryptedWebhookUrl, username: "zerobyte" };
		const submitted = { ...stored, webhookUrl };

		await expect(prepareNotificationConfigUpdate(stored, submitted)).resolves.toEqual({
			config: stored,
			changed: false,
		});
	});

	test("round-trips a stored legacy notification credential without changing it", async () => {
		const stored = {
			type: "slack" as const,
			webhookUrl: "env://LEGACY_SLACK_WEBHOOK",
			username: "zerobyte",
		};
		const presented = redactNotificationConfig(stored);

		expect(presented).toMatchObject({ webhookUrl: STORED_SECRET });
		await expect(prepareNotificationConfigUpdate(stored, presented)).resolves.toEqual({
			config: stored,
			changed: false,
		});
	});
});
