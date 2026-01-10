import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "~/client/components/ui/dialog";
import { ScrollArea } from "~/client/components/ui/scroll-area";
import { formatDate } from "~/client/lib/datetime";
import type { UpdateInfoDto } from "~/server/modules/system/system.dto";

interface ReleaseNotesDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	updates: UpdateInfoDto | undefined;
}

export function ReleaseNotesDialog({ open, onOpenChange, updates }: ReleaseNotesDialogProps) {
	if (!updates) return null;

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="max-h-[80vh] flex flex-col p-0">
				<DialogHeader className="p-6 pb-2">
					<DialogTitle className="flex items-center gap-2">Release Notes</DialogTitle>
					<DialogDescription>
						Current version: {updates.currentVersion} • Latest version: {updates.latestVersion}
					</DialogDescription>
				</DialogHeader>
				<ScrollArea className="p-6 pt-2 h-[50vh] min-w-0">
					<div className="space-y-8">
						{updates.missedReleases.map((release) => (
							<div key={release.version} className="space-y-4">
								<div className="flex items-center justify-between border-b pb-2">
									<h3 className="text-lg font-bold text-foreground">{release.version}</h3>
									<span className="text-sm text-muted-foreground">{formatDate(release.publishedAt)}</span>
								</div>
								<div className="prose prose-sm dark:prose-invert max-w-none prose-pre:bg-muted prose-pre:text-muted-foreground prose-a:text-primary hover:prose-a:underline wrap-anywhere text-wrap prose-pre:whitespace-pre-wrap prose-pre:wrap-anywhere">
									<ReactMarkdown remarkPlugins={[remarkGfm]}>{release.body}</ReactMarkdown>
								</div>
							</div>
						))}
					</div>
				</ScrollArea>
			</DialogContent>
		</Dialog>
	);
}
