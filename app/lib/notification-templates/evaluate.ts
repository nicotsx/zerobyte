import Mustache from "mustache";
import { marked, type Token } from "marked";
import {
	templateVariables,
	type NotificationTemplate,
	type NotificationTemplateContext,
	type NotificationTemplateKey,
} from "./catalog";

export type NotificationDocumentSpan = {
	text: string;
	bold?: boolean;
	italic?: boolean;
	code?: boolean;
	block?: boolean;
};
export type NotificationDocument = { title: string; body: NotificationDocumentSpan[] };
export type TemplateValidationIssue = { field: "title" | "body"; message: string };

export const validateNotificationTemplate = (
	key: NotificationTemplateKey,
	template: NotificationTemplate,
): TemplateValidationIssue[] => {
	const issues: TemplateValidationIssue[] = [];

	for (const field of ["title", "body"] as const) {
		const source = template[field];
		if (!source.trim()) issues.push({ field, message: "Template must not be empty." });
		if (source.length > 16000) issues.push({ field, message: "Template must be at most 16,000 characters." });

		try {
			const visit = (tokens: ReturnType<typeof Mustache.parse>, depth = 0) => {
				if (depth > 8) throw new Error("Sections may nest at most eight levels.");

				for (const token of tokens) {
					const [type, name] = token;
					if (type === "text") {
						if (name.includes("{{") || name.includes("}}"))
							throw new Error("Unclosed or unmatched template tag.");
						continue;
					}
					if (type === "!") continue;
					if (!["name", "#", "^"].includes(type))
						throw new Error("Only variables, optional sections, and comments are supported.");
					if (!templateVariables[key].some((variable) => variable === name))
						throw new Error(`Unknown variable: ${name}`);
					if (Array.isArray(token[4])) visit(token[4], depth + 1);
				}
			};

			visit(new Mustache.Writer().parse(source));
		} catch (error) {
			issues.push({ field, message: error instanceof Error ? error.message : "Invalid template syntax." });
		}
	}

	return issues;
};

export const evaluateNotificationTemplate = (
	key: NotificationTemplateKey,
	template: NotificationTemplate,
	context: NotificationTemplateContext,
): NotificationDocument => {
	const issues = validateNotificationTemplate(key, template);
	if (issues.length) throw new Error(issues.map((issue) => `${issue.field}: ${issue.message}`).join("; "));

	const view: Record<string, string> = Object.create(null);
	for (const variable of templateVariables[key]) {
		const value = context[variable];
		if (value !== undefined && typeof value !== "string")
			throw new Error(`Variable ${variable} must be formatted text.`);
		view[variable] = value ?? "";
	}

	const title = new Mustache.Writer().render(template.title, view, undefined, { escape: (value) => value });

	const literalBody = new Mustache.Writer().render(template.body, view, undefined, { escape: () => "" });
	const literalText = literalBody
		.replace(/&#(?:(\d{1,7})|[Xx]([A-Fa-f0-9]{1,6}));/g, (_, decimal: string | undefined, hex: string) => {
			const code = decimal === undefined ? Number.parseInt(hex, 16) : Number.parseInt(decimal, 10);

			return code >= 65 && code <= 90 ? String.fromCharCode(code) : "";
		})
		.replace(/[^A-Z]/g, "");
	let marker = "ZBNOTIFICATIONVALUE";
	while (literalText.includes(marker)) marker += "X";

	const values: string[] = [];
	const body = new Mustache.Writer().render(template.body, view, undefined, {
		escape: (value) => {
			values.push(value);
			return `${marker}${values.length - 1}END`;
		},
	});
	const substitute = (text: string) =>
		text.replace(new RegExp(`${marker}(\\d+)END`, "g"), (_, index: string) => values[Number(index)] ?? "");
	const spans: NotificationDocumentSpan[] = [];
	const append = (text: string, style: Omit<NotificationDocumentSpan, "text"> = {}) =>
		spans.push({ text: substitute(text), ...style });

	const inline = (tokens: Token[], style: Omit<NotificationDocumentSpan, "text"> = {}) => {
		for (const token of tokens) {
			switch (token.type) {
				case "strong":
					inline(token.tokens ?? [], { ...style, bold: true });
					break;
				case "em":
					inline(token.tokens ?? [], { ...style, italic: true });
					break;
				case "codespan":
					append(token.text, { ...style, code: true });
					break;
				case "br":
					append("\n");
					break;
				case "link":
					inline(token.tokens ?? [], style);
					break;
				case "escape":
				case "image":
					append(token.text, style);
					break;
				case "text":
					if (token.tokens) inline(token.tokens ?? [], style);
					else append(token.text, style);
					break;
				default:
					append(token.raw, style);
			}
		}
	};

	const blocks = (tokens: Token[]) => {
		for (const [index, token] of tokens.entries()) {
			switch (token.type) {
				case "space":
					break;
				case "paragraph":
				case "heading":
					inline(token.tokens ?? []);
					append(tokens[index + 1]?.type === "code" ? "\n" : "\n\n");
					break;
				case "code":
					append(token.text, { code: true, block: true });
					append("\n\n");
					break;
				case "blockquote":
					blocks(token.tokens ?? []);
					break;
				case "list":
					for (const item of token.items) {
						append("• ");
						blocks(item.tokens);
					}
					break;
				case "text":
					if (token.tokens) inline(token.tokens ?? []);
					else append(token.text);
					append("\n");
					break;
				default:
					append(token.raw);
					break;
			}
		}
	};

	blocks(marked.lexer(body, { gfm: false }));
	while (spans.at(-1)?.text === "\n\n") spans.pop();

	return { title, body: spans };
};
