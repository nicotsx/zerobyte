import type { NotificationDocument } from "~/lib/notification-templates/evaluate";

export function NotificationTemplatePreview({ document }: { document: NotificationDocument | null }) {
	return (
		<section aria-label="Message preview" className="min-w-0 space-y-2">
			<h3 className="text-sm leading-none font-medium">Preview</h3>
			<div className="rounded-lg border bg-muted/20 p-4">
				<p className="text-xs text-muted-foreground mb-4">
					Example values. Appearance and message limits vary by service.
				</p>
				{document ? (
					<>
						<p className="font-semibold whitespace-pre-wrap break-words">{document.title}</p>
						<div className="text-sm whitespace-pre-wrap break-words mt-3">
							{document.body.map((span, index) => {
								let content: React.ReactNode = span.text;

								if (span.bold) content = <strong>{content}</strong>;
								if (span.italic) content = <em>{content}</em>;
								if (span.code)
									content = <code className="font-mono rounded bg-muted px-1">{content}</code>;

								return <span key={index}>{content}</span>;
							})}
						</div>
					</>
				) : (
					<p className="text-sm text-muted-foreground">Fix the template errors to see a preview.</p>
				)}
			</div>
		</section>
	);
}
