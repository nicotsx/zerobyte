import { describe, expect, test } from "vitest";
import { mapNotificationConfigSecrets } from "../notification-config-secrets";

describe("mapNotificationConfigSecrets", () => {
	test("transforms only secret fields for a notification config", async () => {
		const transformed = await mapNotificationConfigSecrets(
			{
				type: "slack",
				webhookUrl: "https://hooks.slack.test/services/a/b/c",
				channel: "#alerts",
				username: "zerobyte",
				iconEmoji: ":wave:",
			},
			async (value) => `sealed:${value}`,
		);

		expect(transformed).toEqual({
			type: "slack",
			webhookUrl: "sealed:https://hooks.slack.test/services/a/b/c",
			channel: "#alerts",
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
});
