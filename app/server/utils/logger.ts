import { createLogger, format, transports } from "winston";

import { sanitizeSensitiveData } from "./sanitize";

const { printf, combine, colorize } = format;

const printConsole = printf((info) => `${info.level} > ${String(info.message)}`);
const consoleFormat = combine(colorize(), printConsole);

const getDefaultLevel = () => {
	const isProd = process.env.NODE_ENV === "production";
	return isProd ? "info" : "debug";
};

const winstonLogger = createLogger({
	level: process.env.LOG_LEVEL || getDefaultLevel(),
	format: format.json(),
	transports: [new transports.Console({ level: process.env.LOG_LEVEL || getDefaultLevel(), format: consoleFormat })],
});

const log = (level: "info" | "warn" | "error" | "debug", messages: unknown[]) => {
	const stringMessages = messages.flatMap((m) => {
		if (m instanceof Error) {
			return [sanitizeSensitiveData(m.message), m.stack ? sanitizeSensitiveData(m.stack) : undefined].filter(Boolean);
		}

		if (typeof m === "object") {
			return sanitizeSensitiveData(JSON.stringify(m, null, 2));
		}

		return sanitizeSensitiveData(JSON.stringify(m));
	});

	winstonLogger.log(level, stringMessages.join(" "));
};

export const logger = {
	debug: (...messages: unknown[]) => log("debug", messages),
	info: (...messages: unknown[]) => log("info", messages),
	warn: (...messages: unknown[]) => log("warn", messages),
	error: (...messages: unknown[]) => log("error", messages),
};
