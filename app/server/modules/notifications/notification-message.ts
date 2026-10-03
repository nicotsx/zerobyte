import { sanitizeSensitiveData } from "@zerobyte/core/node";
import type { ResticBackupRunSummaryDto } from "@zerobyte/core/restic";
import type { NotificationEvent } from "~/schemas/notifications";
import { formatDuration } from "~/lib/datetime";
import { formatBytes } from "~/utils/format-bytes";
import type {
	NotificationTemplateSet,
	NotificationTemplateContext,
	NotificationTemplateKey,
} from "~/lib/notification-templates/catalog";
import { boundNotificationText, renderNotificationTemplate } from "~/lib/notification-templates/render";

export type NotificationMessage = { key: NotificationTemplateKey; context: NotificationTemplateContext };

export type BackupNotificationContext = {
	volumeName: string;
	repositoryName: string;
	scheduleName?: string;
	error?: string;
	summary?: ResticBackupRunSummaryDto;
};

export const summarizeNotificationError = (error: string) => {
	const messages: { text: string; terminal: boolean }[] = [];

	for (const line of error.split("\n")) {
		const text = line.trim();
		if (!text) continue;

		try {
			const parsed: unknown = JSON.parse(text);
			if (typeof parsed === "object" && parsed !== null && "message_type" in parsed) {
				if (parsed.message_type === "exit_error" || parsed.message_type === "error") {
					const terminal = parsed.message_type === "exit_error";

					if ("message" in parsed && typeof parsed.message === "string") {
						messages.push({ text: parsed.message, terminal });
					} else if ("error" in parsed && typeof parsed.error === "string") {
						messages.push({ text: parsed.error, terminal });
					} else if (
						"error" in parsed &&
						typeof parsed.error === "object" &&
						parsed.error !== null &&
						"message" in parsed.error &&
						typeof parsed.error.message === "string"
					) {
						messages.push({ text: parsed.error.message, terminal });
					} else {
						messages.push({ text: "Restic failed; see task logs for details.", terminal });
					}
					continue;
				}
			}
		} catch {}

		messages.push({ text, terminal: /^Fatal:\s*/i.test(text) });
	}

	const terminal = messages.filter((message) => message.terminal || /^Fatal:\s*/im.test(message.text));
	const selected = terminal.length ? terminal : messages;
	const sanitized = sanitizeSensitiveData(selected.map((message) => message.text).join("\n"))
		.replace(/\b(pass(?:word)?|token|secret|api[_-]?key)\s*[=:]\s*[^\s,;]+/gi, "$1=***")
		.replace(/\/\/([^:@\s]+):([^@\s]+)@/g, "//$1:***@")
		.replace(/(^|[\s("'=:])(?:[A-Za-z]:\\|\/)[^\s<>"']+/gm, "$1[path]");

	const lines = sanitized.split("\n");
	const fatal = lines.filter((line) => /^Fatal:\s*/i.test(line));
	const diagnostics = fatal.length ? fatal : lines;

	const reasons = [
		[/permission denied|access is denied/i, "Permission denied. Check access to the source and repository."],
		[/no space left on device/i, "No space left on device."],
		[/wrong password|incorrect password/i, "Incorrect repository password."],
		[/\brepository is already locked\b/i, "Repository is locked by another operation."],
	] as const;

	for (const [pattern, message] of reasons) {
		if (pattern.test(diagnostics.join("\n"))) return message;
	}

	const readable = diagnostics.map((line) => line.replace(/^(?:Fatal|error):\s*/i, "").trim()).filter(Boolean);
	const unique = [...new Set(readable)];

	return boundNotificationText(unique.slice(0, 3).join("\n") || "Unknown error", 600);
};

const nameText = (value: string | undefined) =>
	value ? boundNotificationText(value.replace(/[\r\n]+/g, " "), 256) : "";

const bytesText = (bytes: number) => {
	const { text, unit } = formatBytes(bytes, { base: 1024, locale: "en-US", fallback: "-" });

	return unit ? `${text} ${unit}` : text;
};

export const buildBackupNotificationMessage = (
	event: NotificationEvent,
	context: BackupNotificationContext,
): NotificationMessage => {
	const values: NotificationTemplateContext = {
		schedule: nameText(context.scheduleName),
		source: nameText(context.volumeName),
		repository: nameText(context.repositoryName),
	};

	if (event !== "start" && context.summary) {
		const summary = context.summary;

		if (summary.total_duration !== undefined && Number.isFinite(summary.total_duration)) {
			values.duration = formatDuration(Math.round(summary.total_duration));
		}

		if (summary.total_files_processed !== undefined && Number.isFinite(summary.total_files_processed)) {
			values.files = summary.total_files_processed.toLocaleString("en-US");
		}

		if (summary.data_added !== undefined && Number.isFinite(summary.data_added)) {
			values.dataAdded = bytesText(summary.data_added);
		}

		if (summary.data_added_packed !== undefined && Number.isFinite(summary.data_added_packed)) {
			values.dataStored = bytesText(summary.data_added_packed);
		}

		if (
			summary.data_added === undefined &&
			summary.total_bytes_processed !== undefined &&
			Number.isFinite(summary.total_bytes_processed)
		) {
			values.processedSize = bytesText(summary.total_bytes_processed);
		}
	}

	if (context.error && (event === "warning" || event === "failure"))
		values.error = summarizeNotificationError(context.error);

	return { key: `backup_${event}`, context: values };
};

export const buildMirrorFailureNotificationMessage = (context: {
	scheduleName: string;
	sourceRepositoryName: string;
	mirrorRepositoryName: string;
	error: string;
}): NotificationMessage => ({
	key: "mirror_failure",
	context: {
		schedule: nameText(context.scheduleName),
		sourceRepository: nameText(context.sourceRepositoryName),
		mirrorRepository: nameText(context.mirrorRepositoryName),
		error: summarizeNotificationError(context.error),
	},
});

export const buildTestNotificationMessage = (destination: string): NotificationMessage => ({
	key: "test",
	context: { destination: nameText(destination) },
});

export const renderNotificationMessage = (
	message: NotificationMessage,
	shoutrrrUrl: string,
	templates: NotificationTemplateSet,
) => renderNotificationTemplate(message.key, templates[message.key], message.context, shoutrrrUrl);
