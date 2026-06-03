import { CodeBlock } from "~/client/components/ui/code-block";
import { Label } from "~/client/components/ui/label";

type WebhookRequestPreviewProps = {
	method: string;
	url?: string;
	contentType?: string;
	headers?: string[];
	body: string;
};

export const WebhookRequestPreview = ({ method, url, contentType, headers, body }: WebhookRequestPreviewProps) => {
	const headerLines = [contentType ? `Content-Type: ${contentType}` : undefined, ...(headers ?? [])].filter(Boolean);
	const previewCode = `${method} ${url || "https://api.example.com/webhook"}${headerLines.length > 0 ? `\n${headerLines.join("\n")}` : ""}

${body}`;

	return (
		<div className="space-y-2 pt-4 border-t">
			<Label>Request Preview</Label>
			<CodeBlock code={previewCode} filename="HTTP Request" />
			<p className="text-[0.8rem] text-muted-foreground">This is a preview of the HTTP request that will be sent.</p>
		</div>
	);
};
