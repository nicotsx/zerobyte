import { afterEach, expect, test, vi } from "vitest";
import * as core from "@zerobyte/core/node";
import { sendNotification } from "../shoutrrr";

afterEach(() => vi.restoreAllMocks());

test.each([
	["telegram://token@telegram?channels=123", "Backup failed", "Retry error\n".repeat(1000)],
	["telegram://token@telegram?channels=123", "✅ Sauvegarde", "é📦".repeat(1000)],
	["telegram://token@telegram?channels=123:456&notification=no", "Backup failed", "x".repeat(4096)],
	["TELEGRAM://token@telegram?channels=123", "📦".repeat(2000), "x".repeat(4096)],
])("limits Telegram messages without breaking Unicode (%s)", async (shoutrrrUrl, title, body) => {
	const exec = vi.spyOn(core, "safeExec").mockResolvedValue({
		exitCode: 0,
		stdout: "",
		stderr: "",
		timedOut: false,
	});
	const notification = { shoutrrrUrl, title, body };

	expect(await sendNotification(notification)).toEqual({ success: true });
	expect(exec).toHaveBeenCalledTimes(1);
	const args = exec.mock.calls[0]?.[0].args ?? [];
	const sentTitle = args[args.indexOf("--title") + 1] ?? "";
	const sentBody = args[args.indexOf("--message") + 1] ?? "";
	const sentBytes = Buffer.byteLength(`${sentTitle}\n${sentBody}`, "utf8");

	expect(args[args.indexOf("--url") + 1]).toBe(shoutrrrUrl);
	expect(sentBytes).toBeLessThanOrEqual(4096);
	expect(sentBytes).toBeGreaterThan(4092);
	expect(sentBody).toMatch(/\[Truncated; see backup logs for details\.\]$/);
	const retainedBody = sentBody.slice(0, -"\n\n[Truncated; see backup logs for details.]".length);
	expect(body.startsWith(retainedBody)).toBe(true);
	expect(Buffer.from(sentTitle, "utf8").toString("utf8")).toBe(sentTitle);
	expect(Buffer.from(sentBody, "utf8").toString("utf8")).toBe(sentBody);
	expect(sentTitle + sentBody).not.toContain("�");
	expect(notification).toEqual({ shoutrrrUrl, title, body });
});

test.each([
	["telegram://token@telegram?channels=123", "Backup", "x".repeat(4089)],
	["telegram://token@telegram?channels=123", "✅", "é".repeat(2046)],
	["telegram://token@telegram?channels=123", "x".repeat(4090), "Done!"],
	["telegram://token@telegram?channels=123", "Backup", "All done"],
	["smtp://mail.example.com", "Backup", "x".repeat(10000)],
])("preserves messages that do not need truncation (%s)", async (shoutrrrUrl, title, body) => {
	const exec = vi.spyOn(core, "safeExec").mockResolvedValue({
		exitCode: 0,
		stdout: "",
		stderr: "",
		timedOut: false,
	});

	expect(await sendNotification({ shoutrrrUrl, title, body })).toEqual({ success: true });
	expect(exec).toHaveBeenCalledWith({
		command: "shoutrrr",
		args: ["send", "--url", shoutrrrUrl, "--title", title, "--message", body],
	});
});
