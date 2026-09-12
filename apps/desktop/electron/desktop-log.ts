import { app } from "electron";
import path from "node:path";
import { stripVTControlCharacters } from "node:util";
import { sanitizeSensitiveData } from "@zerobyte/core/utils";
import { RotatingLog } from "./rotating-log";

let sink: RotatingLog | undefined;
const secrets = new Set<string>();

export const getDesktopLogsPath = () => path.join(app.getPath("userData"), "logs");

export const redactDesktopLogSecrets = (...values: string[]) => {
	for (const value of values) {
		if (!value) continue;

		secrets.add(value);
		if (value.includes("\n")) {
			for (const line of value.split(/\r?\n/)) {
				if (line) secrets.add(line);
			}
		}
	}
};

const formatRecord = (source: string, message: unknown) => {
	let text = message instanceof Error ? (message.stack ?? message.message) : String(message);
	if (text.length > 64 * 1024) text = "[oversized log record omitted]";
	text = stripVTControlCharacters(text);
	for (const secret of secrets) text = text.replaceAll(secret, "[REDACTED]");

	text = sanitizeSensitiveData(text);

	if (text.length > 64 * 1024) text = `${text.slice(0, 64 * 1024)} [truncated]`;

	return `${new Date().toISOString()} [${source}] ${text}\n`;
};

export const writeDesktopLog = (source: string, message: unknown) => {
	sink ??= new RotatingLog(path.join(getDesktopLogsPath(), "desktop.log"));
	sink.write(formatRecord(source, message));
};

export const closeDesktopLog = async () => {
	await sink?.close();
};
