import { evaluateNotificationTemplate, type NotificationDocumentSpan } from "./evaluate";
import type { NotificationTemplate, NotificationTemplateContext, NotificationTemplateKey } from "./catalog";

const encoder = new TextEncoder();
const bytes = (text: string) => encoder.encode(text).length;
const escapeHtml = (text: string) => text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
const escapeDiscord = (text: string) => text.replace(/([_*~`|[\]<>\\])/g, "\\$1");

const truncateText = (text: string, budget: number, encode: (text: string) => string) => {
	if (bytes(encode(text)) <= budget) return text;

	let result = "";
	let used = 0;
	for (const character of text) {
		const size = bytes(encode(character));
		if (used + size > budget - bytes("…")) break;
		result += character;
		used += size;
	}

	return result + (budget >= bytes("…") ? "…" : "");
};

export const boundNotificationText = (
	text: string,
	budget: number,
	encode: (text: string) => string = (text) => text,
) => encode(truncateText(text, budget, encode));

const escapeShoutrrrHtml = (text: string) => escapeHtml(text).replaceAll('"', "&#34;").replaceAll("'", "&#39;");

export const renderNotificationTemplate = (
	key: NotificationTemplateKey,
	template: NotificationTemplate,
	context: NotificationTemplateContext,
	shoutrrrUrl: string,
) => {
	const document = evaluateNotificationTemplate(key, template, context);
	const url = new URL(shoutrrrUrl);
	const mode = [...url.searchParams].find(([name]) => name.toLowerCase() === "parsemode")?.[1].toLowerCase();
	const telegram = url.protocol.toLowerCase() === "telegram:";
	const html = telegram && mode === "html";
	const slack = url.protocol.toLowerCase() === "slack:";
	const discord = url.protocol.toLowerCase() === "discord:";
	const markdown = telegram && (mode === "markdown" || mode === "markdownv2");

	let encode = (text: string) => text;

	if (html) {
		encode = escapeHtml;
	} else if (markdown && mode === "markdownv2") {
		encode = (text) => text.replace(/([_*[\]()~`>#+\-=|{}.!\\])/g, "\\$1");
	} else if (markdown) {
		encode = (text) => text.replace(/([_*[`\\])/g, "\\$1");
	} else if (discord) {
		encode = escapeDiscord;
	} else if (slack) {
		encode = escapeHtml;
	}

	let encodeTitle = (text: string) => text;

	if (telegram && !markdown) {
		encodeTitle = escapeShoutrrrHtml;
	} else if (discord) {
		encodeTitle = escapeDiscord;
	} else if (slack) {
		encodeTitle = escapeHtml;
	}

	const titleSource = truncateText(document.title.replace(/[\r\n]+/g, " "), 256, encodeTitle);
	let title = titleSource;

	if (discord) {
		title = escapeDiscord(titleSource);
	} else if (slack) {
		title = escapeHtml(titleSource);
	}

	const plainTelegram = telegram && !html && !markdown;
	const bodyCost = plainTelegram ? escapeShoutrrrHtml : encode;
	let budget = 4096;

	if (telegram && markdown) {
		budget -= bytes(title) + 1;
	} else if (telegram) {
		budget -= bytes(`<b>${escapeShoutrrrHtml(title)}</b>\n`);
	}

	let body = "";
	const spans: NotificationDocumentSpan[] = markdown ? [{ text: `${title}\n\n` }, ...document.body] : document.body;

	for (const span of spans) {
		let open = "";
		let close = "";

		if (html) {
			if (span.block) {
				open = "<pre>";
				close = "</pre>";
			} else if (span.code) {
				open = "<code>";
				close = "</code>";
			} else {
				if (span.bold) {
					open += "<b>";
				}
				if (span.italic) {
					open += "<i>";
					close += "</i>";
				}
				if (span.bold) {
					close += "</b>";
				}
			}
		}

		const overhead = bytes(open + close);
		if (budget <= overhead) break;

		const raw = truncateText(span.text, budget - overhead, bodyCost);
		const text = encode(raw);
		body += open + text + close;
		budget -= overhead + bytes(bodyCost(raw));
		if (raw !== span.text) break;
	}

	return { title, body };
};
