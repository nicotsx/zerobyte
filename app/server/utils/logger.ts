import { format } from "date-fns";
import { createConsola, type ConsolaReporter } from "consola";
import { formatWithOptions } from "node:util";
import { sanitizeSensitiveData } from "./sanitize";

type LogLevel = "debug" | "info" | "warn" | "error";

const getDefaultLevel = () => {
	const isProd = process.env.NODE_ENV === "production";
	return isProd ? "info" : "debug";
};

const resolveLogLevel = (): LogLevel => {
	const raw = (process.env.LOG_LEVEL || getDefaultLevel()).toLowerCase();
	if (raw === "debug" || raw === "info" || raw === "warn" || raw === "error") {
		return raw;
	}
	return getDefaultLevel();
};

const consolaLevel: Record<LogLevel, number> = {
	error: 0,
	warn: 1,
	info: 3,
	debug: 4,
};

const useColor = (() => {
	if (process.env.NO_COLOR !== undefined) return false;
	if (process.env.FORCE_COLOR === "1" || process.env.FORCE_COLOR === "true") return true;
	return true;
})();

const levelStyles = {
	debug: { label: "debug", color: "\x1b[34m" },
	info: { label: "info", color: "\x1b[32m" },
	warn: { label: "warn", color: "\x1b[33m" },
	error: { label: "error", color: "\x1b[31m" },
} as const;

const colorize = (color: string, text: string) => (useColor ? `${color}${text}\x1b[0m` : text);

const resolveLevel = (type: string | undefined): LogLevel => {
	if (type === "debug") return "debug";
	if (type === "warn") return "warn";
	if (type === "error" || type === "fatal") return "error";
	return "info";
};

const reporter: ConsolaReporter = {
	log(logObj, ctx) {
		const level = resolveLevel(logObj.type);

		const timestamp = colorize("\x1b[90m", format(new Date(), "HH:mm:ss"));
		const style = levelStyles[level];
		const prefix = colorize(style.color, style.label);
		const tag = logObj.tag ? `[${logObj.tag}]` : "";
		const message = formatWithOptions(
			{
				...ctx.options.formatOptions,
				colors: useColor,
			},
			...logObj.args,
		);
		const line = [timestamp, prefix, tag, message].filter(Boolean).join(" ");
		const stream = logObj.level < 2 ? (ctx.options.stderr ?? process.stderr) : (ctx.options.stdout ?? process.stdout);
		stream.write(line + "\n");
	},
};

const consola = createConsola({
	level: consolaLevel[resolveLogLevel()],
	formatOptions: {
		colors: true,
	},
	reporters: [reporter],
});

const safeStringify = (value: unknown) => {
	try {
		return JSON.stringify(value, null, 2);
	} catch {
		return "[Unserializable object]";
	}
};

const formatMessages = (messages: unknown[]) =>
	messages.flatMap((m) => {
		if (m instanceof Error) {
			return [sanitizeSensitiveData(m.message), m.stack ? sanitizeSensitiveData(m.stack) : undefined].filter(Boolean);
		}

		if (typeof m === "object") {
			return sanitizeSensitiveData(safeStringify(m));
		}

		return sanitizeSensitiveData(String(m as string));
	});

export const logger = {
	debug: (...messages: unknown[]) => consola.debug(formatMessages(messages).join(" ")),
	info: (...messages: unknown[]) => consola.info(formatMessages(messages).join(" ")),
	warn: (...messages: unknown[]) => consola.warn(formatMessages(messages).join(" ")),
	error: (...messages: unknown[]) => consola.error(formatMessages(messages).join(" ")),
};
