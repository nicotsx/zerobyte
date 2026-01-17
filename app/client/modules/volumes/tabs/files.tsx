import { FolderOpen } from "lucide-react";
import { VolumeFileBrowser } from "~/client/components/volume-file-browser";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/client/components/ui/card";
import type { Volume } from "~/client/lib/types";

type Props = {
	volume: Volume;
};

export const FilesTabContent = ({ volume }: Props) => {
	if (volume.status !== "mounted") {
		return (
			<Card>
				<CardContent className="flex flex-col items-center justify-center text-center py-12">
					<FolderOpen className="mb-4 h-12 w-12 text-muted-foreground" />
					<p className="text-muted-foreground">Volume must be mounted to browse files.</p>
					<p className="text-sm text-muted-foreground mt-2">Mount the volume to explore its contents.</p>
				</CardContent>
			</Card>
		);
	}

	return (
		<Card className="h-[600px] flex flex-col">
			<CardHeader>
				<CardTitle>File Explorer</CardTitle>
				<CardDescription>Browse the files and folders in this volume.</CardDescription>
			</CardHeader>
			<CardContent className="flex-1 overflow-hidden flex flex-col">
				<VolumeFileBrowser
					volumeId={volume.shortId}
					enabled={volume.status === "mounted"}
					className="overflow-auto flex-1 border rounded-md bg-card p-2"
					emptyMessage="This volume is empty."
					emptyDescription="Files and folders will appear here once you add them."
				/>
			</CardContent>
		</Card>
	);
};
