import { FolderOpen } from "lucide-react";
import { VolumeFileBrowser } from "~/client/components/file-browsers/volume-file-browser";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/client/components/ui/card";
import type { PresentedVolume } from "~/client/lib/types";
import { getRemoteSourcePresentation } from "../source-presentation";

type Props = {
	volume: PresentedVolume;
};

export const FilesTabContent = ({ volume }: Props) => {
	const isDirectory = volume.type === "directory";
	const remotePresentation = volume.sourceKind === "agent-filesystem" ? getRemoteSourcePresentation(volume) : null;
	const sourceIsBrowsable = remotePresentation ? remotePresentation.isActionable : volume.status === "mounted";
	const requestErrorMessage = remotePresentation
		? "Files could not be loaded. Check the source availability and try again."
		: undefined;

	if (!sourceIsBrowsable) {
		const blockedMessage = remotePresentation
			? remotePresentation.explanation
			: isDirectory
				? "Directory is not accessible."
				: "Source must be mounted to browse files.";
		const blockedGuidance = remotePresentation
			? remotePresentation.guidance
			: isDirectory
				? "Make sure the folder exists and is accessible, then run Check Now."
				: "Mount the source to explore its contents.";
		return (
			<Card>
				<CardContent className="flex flex-col items-center justify-center text-center py-12">
					<FolderOpen className="mb-4 h-12 w-12 text-muted-foreground" />
					<output className="text-pretty text-muted-foreground">{blockedMessage}</output>
					<p className="mt-2 text-pretty text-sm text-muted-foreground">{blockedGuidance}</p>
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
					enabled={sourceIsBrowsable}
					className="overflow-auto flex-1 border rounded-md bg-card p-2"
					requestErrorMessage={requestErrorMessage}
					emptyMessage="This source is empty."
					emptyDescription="Files and folders will appear here once you add them."
				/>
			</CardContent>
		</Card>
	);
};
