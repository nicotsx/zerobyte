import { describe, expect, test } from "bun:test";
import { buildCustomShoutrrrUrl } from "../builders/custom";
import { buildDiscordShoutrrrUrl } from "../builders/discord";
import { buildEmailShoutrrrUrl } from "../builders/email";
import { buildGenericShoutrrrUrl } from "../builders/generic";
import { buildGotifyShoutrrrUrl } from "../builders/gotify";
import { buildNtfyShoutrrrUrl } from "../builders/ntfy";
import { buildPushoverShoutrrrUrl } from "../builders/pushover";
import { buildSlackShoutrrrUrl } from "../builders/slack";
import { buildTelegramShoutrrrUrl } from "../builders/telegram";

describe("notification shoutrrr URL builders", () => {
	test("builds email URLs with and without optional auth fields", () => {
		expect(
			buildEmailShoutrrrUrl({
				type: "email",
				smtpHost: "smtp.example.com",
				smtpPort: 587,
				from: "alerts@example.com",
				to: ["ops@example.com", "dev@example.com"],
				useTLS: true,
			}),
		).toBe(
			"smtp://smtp.example.com:587/?from=alerts%40example.com&to=ops%40example.com%2Cdev%40example.com&starttls=yes",
		);

		expect(
			buildEmailShoutrrrUrl({
				type: "email",
				smtpHost: "smtp.example.com",
				smtpPort: 465,
				username: "user name",
				password: "p@ss word",
				from: "alerts+team@example.com",
				fromName: "Ops Team",
				to: ["ops@example.com"],
				useTLS: false,
			}),
		).toBe(
			"smtp://user%20name:p%40ss%20word@smtp.example.com:465/?from=alerts%2Bteam%40example.com&fromname=Ops+Team&to=ops%40example.com&starttls=no",
		);
	});

	test("builds discord URLs and rejects invalid webhook formats", () => {
		expect(
			buildDiscordShoutrrrUrl({
				type: "discord",
				webhookUrl: "https://discord.com/api/webhooks/123/token",
			}),
		).toBe("discord://token@123?splitLines=false");

		expect(
			buildDiscordShoutrrrUrl({
				type: "discord",
				webhookUrl: "https://discord.com/api/webhooks/123/token",
				username: "Bot Name",
				avatarUrl: "https://example.com/avatar.png",
				threadId: "999",
			}),
		).toBe(
			"discord://token@123?splitLines=false&username=Bot+Name&avatarurl=https%3A%2F%2Fexample.com%2Favatar.png&thread_id=999",
		);

		expect(() =>
			buildDiscordShoutrrrUrl({
				type: "discord",
				webhookUrl: "https://discord.com/invalid",
			}),
		).toThrow("Invalid Discord webhook URL format");
	});

	test("builds gotify URLs for https and http servers", () => {
		expect(
			buildGotifyShoutrrrUrl({
				type: "gotify",
				serverUrl: "https://gotify.example.com",
				token: "secret-token",
				priority: 0,
			}),
		).toBe("gotify://gotify.example.com/secret-token?priority=0");

		expect(
			buildGotifyShoutrrrUrl({
				type: "gotify",
				serverUrl: "http://gotify.example.com:8080",
				token: "secret-token",
				path: "/custom/path/",
				priority: 7,
			}),
		).toBe("gotify://gotify.example.com:8080/custom/path/secret-token?DisableTLS=true&priority=7");
	});

	test("builds ntfy URLs for default host, custom server auth, and access tokens", () => {
		expect(
			buildNtfyShoutrrrUrl({
				type: "ntfy",
				topic: "topic-name",
				priority: "default",
			}),
		).toBe("ntfy://ntfy.sh/topic-name?priority=default");

		expect(
			buildNtfyShoutrrrUrl({
				type: "ntfy",
				serverUrl: "http://ntfy.example.com:8080",
				topic: "topic-name",
				priority: "high",
				username: "user name",
				password: "p@ss word",
			}),
		).toBe("ntfy://user%20name:p%40ss%20word@ntfy.example.com:8080/topic-name?scheme=http&priority=high");

		expect(
			buildNtfyShoutrrrUrl({
				type: "ntfy",
				topic: "topic-name",
				priority: "min",
				accessToken: "token value",
			}),
		).toBe("ntfy://:token%20value@ntfy.sh/topic-name?priority=min");

		expect(
			buildNtfyShoutrrrUrl({
				type: "ntfy",
				topic: "topic-name",
				priority: "max",
				username: "user name",
				password: "p@ss word",
				accessToken: "token value",
			}),
		).toBe("ntfy://:token%20value@ntfy.sh/topic-name?priority=max");
	});

	test("builds pushover URLs with and without optional query params", () => {
		expect(
			buildPushoverShoutrrrUrl({
				type: "pushover",
				userKey: "user-key",
				apiToken: "api-token",
				priority: 0,
			}),
		).toBe("pushover://shoutrrr:api-token@user-key/?priority=0");

		expect(
			buildPushoverShoutrrrUrl({
				type: "pushover",
				userKey: "user-key",
				apiToken: "api-token",
				devices: "iphone,ipad",
				priority: 1,
			}),
		).toBe("pushover://shoutrrr:api-token@user-key/?devices=iphone%2Cipad&priority=1");
	});

	test("builds slack URLs and rejects invalid webhook formats", () => {
		expect(
			buildSlackShoutrrrUrl({
				type: "slack",
				webhookUrl: "https://hooks.slack.com/services/T000/B000/XXX",
			}),
		).toBe("slack://hook:T000-B000-XXX@webhook");

		expect(
			buildSlackShoutrrrUrl({
				type: "slack",
				webhookUrl: "https://hooks.slack.com/services/T000/B000/XXX",
				channel: "#alerts",
				username: "Alert Bot",
				iconEmoji: ":robot_face:",
			}),
		).toBe("slack://hook:T000-B000-XXX@webhook?channel=%23alerts&username=Alert+Bot&icon_emoji=%3Arobot_face%3A");

		expect(() =>
			buildSlackShoutrrrUrl({
				type: "slack",
				webhookUrl: "https://hooks.slack.com/not-services/T/B/C",
			}),
		).toThrow("Invalid Slack webhook URL format");
	});

	test("builds telegram URLs with and without thread ids", () => {
		expect(
			buildTelegramShoutrrrUrl({
				type: "telegram",
				botToken: "123456:ABCdef",
				chatId: "chat-id",
			}),
		).toBe("telegram://123456:ABCdef@telegram?channels=chat-id");

		expect(
			buildTelegramShoutrrrUrl({
				type: "telegram",
				botToken: "123456:ABCdef",
				chatId: "chat-id",
				threadId: "thread-id",
			}),
		).toBe("telegram://123456:ABCdef@telegram?channels=chat-id:thread-id");
	});

	test("builds generic URLs with reserved params, transport flags, and headers", () => {
		expect(
			buildGenericShoutrrrUrl({
				type: "generic",
				url: "https://example.com/hooks/path?foo=bar&title=kept",
				method: "POST",
			}),
		).toBe("generic://example.com/hooks/path?foo=bar&_title=kept&method=POST");

		expect(
			buildGenericShoutrrrUrl({
				type: "generic",
				url: "http://example.com/hooks/path?contenttype=text/plain&foo=bar",
				method: "GET",
				contentType: "application/json",
				headers: ["X-Test: one", "X-Trace: two:three"],
				useJson: true,
				titleKey: "title",
				messageKey: "message",
			}),
		).toBe(
			"generic://example.com/hooks/path?_contenttype=text%2Fplain&foo=bar&disabletls=yes&method=GET&contenttype=application%2Fjson&template=json&titlekey=title&messagekey=message&%40X-Test=one&%40X-Trace=two%3Athree",
		);

		expect(
			buildGenericShoutrrrUrl({
				type: "generic",
				url: "https://example.com/hooks/path",
				method: "POST",
				headers: ["Malformed", "X-Test: one"],
			}),
		).toBe("generic://example.com/hooks/path?method=POST&%40X-Test=one");
	});

	test("returns custom URLs as-is", () => {
		expect(
			buildCustomShoutrrrUrl({
				type: "custom",
				shoutrrrUrl: "custom://already-built",
			}),
		).toBe("custom://already-built");
	});
});
