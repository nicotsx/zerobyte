import { expect, test } from "vitest";
import { defaultNotificationTemplates, notificationTemplateKeys } from "~/lib/notification-templates/catalog";
import { evaluateNotificationTemplate, validateNotificationTemplate } from "~/lib/notification-templates/evaluate";
import { renderNotificationTemplate } from "~/lib/notification-templates/render";

const telegram = "telegram://token@telegram?channels=123&parseMode=HTML";

test.each(notificationTemplateKeys)("built-in %s is a valid editable template", (key) => {
	expect(validateNotificationTemplate(key, defaultNotificationTemplates[key])).toEqual([]);
});

test.each([
	["{{unknown}}", "Unknown variable"],
	["{{#source}}oops", "Unclosed section"],
	["{{source", "Unclosed tag"],
	["{{{source}}}", "Only variables"],
	["{{>include}}", "Only variables"],
	["{{=<< >>=}}", "Only variables"],
	["{{constructor}}", "Unknown variable"],
	["{{#source}}{{.}}{{/source}}", "Unknown variable"],
])("rejects invalid or unsupported template syntax: %s", (body, message) => {
	const template = { title: "Backup", body };

	expect(validateNotificationTemplate("backup_start", template)).toEqual([
		{ field: "body", message: expect.stringContaining(message) },
	]);
	expect(() => evaluateNotificationTemplate("backup_start", template, {})).toThrow();
});

test("rejects empty templates rather than silently restoring defaults", () => {
	expect(validateNotificationTemplate("test", { title: "", body: " " })).toEqual([
		{ field: "title", message: "Template must not be empty." },
		{ field: "body", message: "Template must not be empty." },
	]);
});

test("user titles and bodies use the same evaluator and can omit emojis and every default label", () => {
	const result = renderNotificationTemplate(
		"backup_success",
		{
			title: "Saved {{source}}",
			body: "**{{repository}}** has {{files}} files.{{#duration}}\nTook {{duration}}{{/duration}}{{^duration}}\nNo timing available.{{/duration}}",
		},
		{ source: "Documents", repository: "Cloud", files: "0" },
		telegram,
	);

	expect(result).toEqual({
		title: "Saved Documents",
		body: "<b>Cloud</b> has 0 files.\nNo timing available.",
	});
});

test("data stays literal inside Markdown, optional sections, code blocks, and marker-like text", () => {
	const source = "ZBNOTIFICATIONVALUE0END\n**bold** <b>html</b> & `code`";
	const error = "```\n<i>bad</i>\n{{source}}";
	const result = renderNotificationTemplate(
		"backup_failure",
		{
			title: "{{source}}",
			body: "**Source:** {{source}}\n\n```\n{{error}}\n```",
		},
		{ source, error },
		telegram,
	);

	expect(result.title).toBe(source.replaceAll("\n", " "));
	expect(result.body).toContain("ZBNOTIFICATIONVALUE0END\n**bold** &lt;b&gt;html&lt;/b&gt; &amp; `code`");
	expect(result.body).toContain("<pre>```\n&lt;i&gt;bad&lt;/i&gt;\n{{source}}</pre>");
	expect(result.body).not.toContain("<b>bold</b>");
});

test("template literal markers cannot collide with interpolated values", () => {
	const result = renderNotificationTemplate(
		"test",
		{
			title: "Test",
			body: "ZBNOTIFICATIONVALUE0END {{destination}}",
		},
		{ destination: "ZBNOTIFICATIONVALUEX0END" },
		"discord://token@id",
	);

	expect(result.body).toBe("ZBNOTIFICATIONVALUE0END ZBNOTIFICATIONVALUEX0END");
});

test.each([
	"ZBNOTIFICATION{{! comment}}VALUE0END {{destination}}",
	"ZBNOTIFICATION{{#destination}}{{/destination}}VALUE0END {{destination}}",
	"ZBNOTIFICATION{{^destination}}hidden{{/destination}}VALUE0END {{destination}}",
	"ZBNOTIFICATIO&#78;VALUE0END {{destination}}",
	"ZBNOTIFICATIO&#x4e;VALUE0END {{destination}}",
])("keeps transformed literal markers distinct from variable data (%s)", (body) => {
	const result = renderNotificationTemplate(
		"test",
		{ title: "Test", body },
		{ destination: "Alerts ZBNOTIFICATIONVALUE0END ZBNOTIFICATIONVALUEX0END" },
		telegram,
	);

	expect(result.body).toBe("ZBNOTIFICATIONVALUE0END Alerts ZBNOTIFICATIONVALUE0END ZBNOTIFICATIONVALUEX0END");
});

test.each([
	[
		"telegram://token@telegram?channels=123",
		"Use *literal stars* and `literal backticks` & <text>. Path: C:\\backup",
	],
	["ntfy://example.com/topic", "Use *literal stars* and `literal backticks` & <text>. Path: C:\\backup"],
	[telegram, "Use *literal stars* and `literal backticks` &amp; &lt;text&gt;. Path: C:\\backup"],
])("renders Markdown escapes as literal text while preserving literal backslashes (%s)", (url, expected) => {
	const result = renderNotificationTemplate(
		"test",
		{ title: "Test", body: "Use \\*literal stars\\* and \\`literal backticks\\` & <text>. Path: C:\\\\backup" },
		{},
		url,
	);

	expect(result.body).toBe(expected);
});

test("marker selection stays safe when interpolation changes Markdown entity decoding", () => {
	const result = renderNotificationTemplate(
		"test",
		{ title: "Test", body: "{{destination}}    ZBNOTIFICATIO&#78;VALUE0END {{destination}}" },
		{ destination: "Alerts" },
		"ntfy://example.com/topic",
	);

	expect(result.body).toBe("Alerts    ZBNOTIFICATIONVALUE0END Alerts");
});

test("unsupported links and HTML do not grant data a provider markup context", () => {
	const result = renderNotificationTemplate(
		"test",
		{
			title: "Test",
			body: "[**{{destination}}**](https://example.com)\n<script>alert(1)</script>",
		},
		{ destination: "<i>value</i>" },
		telegram,
	);

	expect(result.body).toContain("<b>&lt;i&gt;value&lt;/i&gt;</b>");
	expect(result.body).not.toContain("<script>");
});

test.each([
	telegram,
	"telegram://token@telegram?channels=123",
	"telegram://token@telegram?channels=123&parseMode=MarkdownV2",
	"discord://token@id",
])("arbitrary repeated variables and long literal UTF-8 stay within delivery limits (%s)", (url) => {
	const result = renderNotificationTemplate(
		"test",
		{
			title: "📦<&".repeat(2000),
			body: `**${"{{destination}}".repeat(500)}**${"📦<&".repeat(1000)}`,
		},
		{ destination: "📦<>&".repeat(1000) },
		url,
	);
	const combined =
		url === telegram
			? `<b>${result.title.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")}</b>\n${result.body}`
			: result.body;

	expect(Buffer.byteLength(combined)).toBeLessThanOrEqual(4096);
	if (url.startsWith("telegram:")) {
		expect(Buffer.byteLength(result.title) + Buffer.byteLength(result.body) + 1).toBeLessThanOrEqual(4096);
	}
	expect(Buffer.byteLength(result.title)).toBeLessThanOrEqual(256);
	expect(combined).not.toContain("�");
	if (url === telegram) {
		expect(result.body).toMatch(/<\/b>$/);
		expect(result.body).not.toMatch(/&(a|am|amp|l|lt|g|gt)?(?=<\/b>)/);
	}
});

test("long literal bodies and Shoutrrr plain Telegram escaping also fit the final payload", () => {
	const escape = (text: string) =>
		text
			.replaceAll("&", "&amp;")
			.replaceAll("<", "&lt;")
			.replaceAll(">", "&gt;")
			.replaceAll('"', "&#34;")
			.replaceAll("'", "&#39;");
	const result = renderNotificationTemplate(
		"test",
		{
			title: "\"'📦<&".repeat(1000),
			body: "\"'📦<&".repeat(2000),
		},
		{},
		"telegram://token@telegram?channels=123",
	);

	expect(Buffer.byteLength(`<b>${escape(result.title)}</b>\n${escape(result.body)}`)).toBeLessThanOrEqual(4096);
	expect(result.body).not.toContain("�");
});

test("Discord displays literal names and diagnostics instead of interpreting their Markdown", () => {
	const result = renderNotificationTemplate(
		"backup_failure",
		{
			title: "Failed {{source}}",
			body: "**Source:** {{source}}\n\n```\n{{error}}\n```",
		},
		{ source: "**bold**", error: "`code` <@123>" },
		"discord://token@id",
	);

	expect(result.title).toBe("Failed \\*\\*bold\\*\\*");
	expect(result.body).toContain("Source: \\*\\*bold\\*\\*");
	expect(result.body).toContain("\\`code\\` \\<@123\\>");
});

test("Slack escapes native link and mention delimiters while retaining readable text", () => {
	const result = renderNotificationTemplate(
		"test",
		{
			title: "Alerts for {{destination}}",
			body: "**Destination:** {{destination}}",
		},
		{ destination: "<@team> & backup" },
		"slack://token@channel",
	);

	expect(result.title).toBe("Alerts for &lt;@team&gt; &amp; backup");
	expect(result.body).toBe("Destination: &lt;@team&gt; &amp; backup");
});
