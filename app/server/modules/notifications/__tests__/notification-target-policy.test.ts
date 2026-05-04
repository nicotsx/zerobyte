import { describe, expect, test } from "vitest";
import { assertNotificationTargetAllowed } from "../utils/notification-target-policy";

describe("assertNotificationTargetAllowed", () => {
	test("requires email SMTP targets to match the allowlist", () => {
		const notificationConfig = {
			type: "email" as const,
			smtpHost: "smtp.example.com",
			smtpPort: 587,
			from: "backups@example.com",
			to: ["admin@example.com"],
			useTLS: true,
		};

		expect(() => assertNotificationTargetAllowed(notificationConfig, [])).toThrow(
			"Add smtp://smtp.example.com:587 to WEBHOOK_ALLOWED_ORIGINS",
		);

		expect(() => assertNotificationTargetAllowed(notificationConfig, ["smtp://smtp.example.com:587"])).not.toThrow();
		expect(() => assertNotificationTargetAllowed(notificationConfig, ["smtp://smtp.example.com:25"])).toThrow();
	});

	test("rejects notification types that are not classified by the SSRF policy", () => {
		expect(() => assertNotificationTargetAllowed({ type: "future-networked" } as never, [])).toThrow(
			'Unsupported notification type "future-networked" for the SSRF policy.',
		);
	});

	test("allows fixed-provider custom Shoutrrr services without a network target allowlist", () => {
		expect(() =>
			assertNotificationTargetAllowed({ type: "custom", shoutrrrUrl: "discord://token@webhook-id" }, []),
		).not.toThrow();
	});

	test("requires custom generic targets to match the allowlist", () => {
		expect(() =>
			assertNotificationTargetAllowed({ type: "custom", shoutrrrUrl: "generic://hooks.example.com/path" }, []),
		).toThrow("Add https://hooks.example.com to WEBHOOK_ALLOWED_ORIGINS");

		expect(() =>
			assertNotificationTargetAllowed({ type: "custom", shoutrrrUrl: "generic://hooks.example.com/path" }, [
				"https://hooks.example.com",
			]),
		).not.toThrow();
	});

	test("requires custom generic shortcut targets to match the allowlist", () => {
		expect(() =>
			assertNotificationTargetAllowed({ type: "custom", shoutrrrUrl: "generic+http://127.0.0.1:8080/webhook" }, [
				"http://127.0.0.1:8080",
			]),
		).not.toThrow();
	});

	test("requires custom smtp targets to match by scheme, host, and port", () => {
		const notificationConfig = {
			type: "custom" as const,
			shoutrrrUrl: "smtp://127.0.0.1:2525/?from=test@example.com&to=admin@example.com",
		};

		expect(() => assertNotificationTargetAllowed(notificationConfig, [])).toThrow(
			"Add smtp://127.0.0.1:2525 to WEBHOOK_ALLOWED_ORIGINS",
		);

		expect(() => assertNotificationTargetAllowed(notificationConfig, ["smtp://127.0.0.1:2525"])).not.toThrow();
		expect(() => assertNotificationTargetAllowed(notificationConfig, ["smtp://127.0.0.1:25"])).toThrow();
	});

	test("rejects custom Shoutrrr schemes that are not classified by the SSRF policy", () => {
		expect(() =>
			assertNotificationTargetAllowed({ type: "custom", shoutrrrUrl: "unknown://example.com/path" }, []),
		).toThrow('Custom Shoutrrr scheme "unknown" is not supported by the SSRF policy.');
	});
});
