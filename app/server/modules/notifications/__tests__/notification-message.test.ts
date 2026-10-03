import { expect, test } from "vitest";
import { fromPartial } from "@total-typescript/shoehorn";
import {
	buildBackupNotificationMessage,
	renderNotificationMessage as renderMessage,
	summarizeNotificationError,
} from "../notification-message";

import { defaultNotificationTemplates } from "~/lib/notification-templates/catalog";

const renderNotificationMessage = (message: Parameters<typeof renderMessage>[0], url: string) =>
	renderMessage(message, url, defaultNotificationTemplates);

const context = { scheduleName: "Nightly", volumeName: "Documents", repositoryName: "Cloud" };

test("shows compact statistics including zeros and omits internal counters and snapshot hashes", () => {
	const message = buildBackupNotificationMessage("success", {
		...context,
		summary: fromPartial({
			total_duration: 0,
			total_files_processed: 0,
			data_added: 0,
			data_added_packed: 0,
			files_new: 12,
			dirs_new: 200,
			data_blobs: 400,
			snapshot_id: "abcdef1234567890",
		}),
	});
	const { title, body } = renderNotificationMessage(message, "discord://token@id");

	expect(title).toBe("✅ Backup completed · Zerobyte");
	expect(body).toContain("Duration: 0s");
	expect(body).toContain("Files: 0");
	expect(body).toContain("Data added: 0");
	expect(body).toContain("Data stored: 0");
	expect(body.match(/Nightly/g)).toHaveLength(1);
	expect(body).not.toMatch(/blobs|Dirs|Snapshot|abcdef|<b>/);
});

test("sparse summaries show only available statistics with processed size as a fallback", () => {
	const { body } = renderNotificationMessage(
		buildBackupNotificationMessage("success", {
			...context,
			summary: fromPartial({ total_bytes_processed: 1024, total_duration: 2 }),
		}),
		"smtp://mail.example.com",
	);

	expect(body).toContain("Duration: 2s");
	expect(body).toContain("Size: 1 KiB");
	expect(body).not.toMatch(/Files|Data added|Data stored|N\/A/);
});

test("turns duplicate stderr and a structured Restic exit error into one readable reason", () => {
	const error =
		"Stat(<config/>) failed: stat /private/secret/config: permission denied\n" +
		JSON.stringify({
			message_type: "exit_error",
			code: 1,
			message:
				"Fatal: unable to open config file: stat /private/secret/config: permission denied\n/private/secret",
		});
	const { body } = renderNotificationMessage(
		buildBackupNotificationMessage("failure", { ...context, error }),
		"discord://token@id",
	);

	expect(body).toContain("Error:\nPermission denied. Check access to the source and repository.");
	expect(body).not.toMatch(/message_type|exit_error|secret|Stat|Fatal|<pre>/);
	expect(body.match(/Permission denied/g)).toHaveLength(1);
});

test("preserves unfamiliar useful errors while decoding, deduplicating, bounding, and sanitizing them", () => {
	expect(
		summarizeNotificationError(
			"Cloud connection lost\n" +
				JSON.stringify({ message_type: "exit_error", message: "Fatal: Cloud connection lost" }),
		),
	).toBe("Cloud connection lost");
	const error = summarizeNotificationError(
		"Could not read /private/machine/repo/config password=topsecret token=tokenvalue\n" + "📦".repeat(1000),
	);

	expect(error).toContain("Could not read [path] password=*** token=***");
	expect(error).not.toMatch(/topsecret|tokenvalue|\/private|�/);
	expect(Buffer.byteLength(error)).toBeLessThanOrEqual(600);
});

test.each([
	"unable to create lock in backend: client.PutObject: Access Denied",
	"unable to create lock in backend: dial tcp 127.0.0.1:9000: connect: connection refused",
])("preserves backend lock-creation failures without reporting contention (%s)", (cause) => {
	const { body } = renderNotificationMessage(
		buildBackupNotificationMessage("failure", { ...context, error: `Fatal: ${cause}` }),
		"discord://token@id",
	);

	expect(body).toContain(`Error:\n${cause}`);
	expect(body).not.toContain("Repository is locked");
});

test.each([
	"/backup/repository-locked/config",
	"/backup/repository-is-already-locked/config",
	"C:\\backup\\repository-locked\\config",
])("redacts paths containing lock-related words without reporting contention (%s)", (path) => {
	expect(summarizeNotificationError(`Fatal: stat ${path}: no such file or directory`)).toBe(
		"stat [path] no such file or directory",
	);
});

test("summarizes genuine repository contention from a structured Restic diagnostic", () => {
	expect(
		summarizeNotificationError(
			JSON.stringify({
				message_type: "exit_error",
				message: "Fatal: unable to create lock in backend: repository is already locked exclusively by PID 42",
			}),
		),
	).toBe("Repository is locked by another operation.");
});

test("keeps the terminal fatal cause after noisy output exceeds the summary line budget", () => {
	const error = [
		"using temporary cache",
		"loading index",
		"checking repository",
		"retrying backend request",
		JSON.stringify({
			message_type: "exit_error",
			message: "Fatal: unable to create lock in backend: client.PutObject: Access Denied",
		}),
	].join("\n");

	expect(summarizeNotificationError(error)).toBe("unable to create lock in backend: client.PutObject: Access Denied");
});

test.each([
	JSON.stringify({
		message_type: "error",
		message: "Fatal: unable to save snapshot: dial tcp 127.0.0.1:9000: connect: connection refused",
	}),
	JSON.stringify({
		message_type: "exit_error",
		message: "Fatal: unable to save snapshot: dial tcp 127.0.0.1:9000: connect: connection refused",
	}),
	JSON.stringify({
		message_type: "exit_error",
		message: "unable to save snapshot: dial tcp 127.0.0.1:9000: connect: connection refused",
	}),
	"Fatal: unable to save snapshot: dial tcp 127.0.0.1:9000: connect: connection refused",
])("preserves the terminal cause over earlier archival permission errors (%s)", (terminal) => {
	const error = [
		JSON.stringify({
			message_type: "error",
			during: "archival",
			error: { message: "open /documents/private: permission denied" },
		}),
		"error: open /documents/other: permission denied",
		terminal,
	].join("\n");
	const { body } = renderNotificationMessage(
		buildBackupNotificationMessage("failure", { ...context, error }),
		"ntfy://example.com/topic",
	);

	expect(body).toContain("Error:\nunable to save snapshot: dial tcp 127.0.0.1:9000: connect: connection refused");
	expect(body).not.toMatch(/Permission denied|private|other|message_type/);
});

test("summarizes archival warnings when no terminal diagnostic exists", () => {
	const error = [
		JSON.stringify({ message_type: "error", error: { message: "open /documents/private: permission denied" } }),
		"some source files could not be read",
	].join("\n");

	expect(summarizeNotificationError(error)).toBe("Permission denied. Check access to the source and repository.");
});

test("Telegram renders escaped bold labels and a separate error block within the sender byte budget", () => {
	const { title, body } = renderNotificationMessage(
		buildBackupNotificationMessage("failure", {
			scheduleName: "Nightly <b>bad</b> & 📦".repeat(1000),
			volumeName: "<>&📦".repeat(1000),
			repositoryName: "<>&📦".repeat(1000),
			error: "An unfamiliar <b>error</b> & 📦".repeat(1000),
		}),
		"telegram://token@telegram?channels=123&parseMode=HTML",
	);

	expect(body).toContain("<b>Schedule:</b> Nightly &lt;b&gt;bad&lt;/b&gt; &amp; 📦");
	expect(body).toContain("\n\n<b>Error:</b>\n<pre>An unfamiliar &lt;b&gt;error&lt;/b&gt; &amp; 📦");
	expect(body).toMatch(/<\/pre>$/);
	expect(body).not.toMatch(/<b>bad|<b>error|�/);
	expect(Buffer.byteLength(`<b>${title}</b>\n${body}`)).toBeLessThanOrEqual(4096);
});

test.each(["telegram://token@telegram?channels=123", "discord://token@id", "ntfy://example.com/topic"])(
	"plain destinations keep readable text without generated HTML (%s)",
	(url) => {
		const { body } = renderNotificationMessage(
			buildBackupNotificationMessage("warning", { ...context, error: "Cloud connection lost" }),
			url,
		);

		expect(body).toContain(
			"Schedule: Nightly\nSource: Documents\nRepository: Cloud\n\nWarning:\nCloud connection lost",
		);
		expect(body).not.toMatch(/<b>|<pre>|&amp;/);
	},
);

test("custom Telegram Markdown modes escape user text without adding HTML", () => {
	const { body } = renderNotificationMessage(
		buildBackupNotificationMessage("failure", {
			...context,
			scheduleName: "[Nightly](https://example.com) *bold*",
			error: "Unfamiliar error!",
		}),
		"telegram://token@telegram?channels=123&parseMode=MarkdownV2",
	);

	expect(body).toContain("\\[Nightly\\]\\(https://example\\.com\\) \\*bold\\*");
	expect(body).toContain("Unfamiliar error\\!");
	expect(body).not.toMatch(/<b>|<pre>/);
});

test("decodes structured archival errors and suppresses records with no readable message", () => {
	expect(
		summarizeNotificationError(
			JSON.stringify({
				message_type: "error",
				during: "archival",
				item: "/private/file",
				error: { message: "File changed during backup" },
			}),
		),
	).toBe("File changed during backup");
	expect(summarizeNotificationError(JSON.stringify({ message_type: "exit_error", code: 1 }))).toBe(
		"Restic failed; see task logs for details.",
	);
});
