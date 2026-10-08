import { FolderOpen } from "lucide-react";
import { VolumeFileBrowser } from "~/client/components/file-browsers/volume-file-browser";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/client/components/ui/card";
import type { Volume } from "~/client/lib/types";
import { cn } from "~/client/lib/utils";

type Props = {
	volume: Volume;
};

export const FilesTabContent = ({ volume }: Props) => {
	if (volume.status !== "mounted") {
		const canMount = volume.sourceKind === "managed" && volume.type !== "directory";

		return (
			<Card>
				<CardContent className="flex flex-col items-center justify-center text-center py-12">
					<FolderOpen className="mb-4 h-12 w-12 text-muted-foreground" />
					<div className={cn({ hidden: !canMount })}>
						<p className="text-muted-foreground">Source must be mounted to browse files.</p>
						<p className="text-sm text-muted-foreground mt-2">Mount the source to explore its contents.</p>
					</div>
					<div className={cn({ hidden: canMount })}>
						<p className="text-muted-foreground">Directory is not accessible.</p>
						<p className="text-sm text-muted-foreground mt-2">
							Make sure the folder exists and is accessible, then run Check Now.
						</p>
					</div>
				</CardContent>
			</Card>
		);
	}

	return (
		<Card className="h-[600px] flex flex-col">
			<CardHeader>
				<CardTitle>File Explorer</CardTitle>
				<CardDescription>Browse the files and folders in this source.</CardDescription>
			</CardHeader>
			<CardContent className="flex-1 overflow-hidden flex flex-col">
				<VolumeFileBrowser
					volumeId={volume.shortId}
					enabled={volume.status === "mounted"}
					className="overflow-auto flex-1 border rounded-md bg-card p-2"
					emptyMessage="This source is empty."
					emptyDescription="Files and folders will appear here once you add them."
				/>
			</CardContent>
		</Card>
	);
};
