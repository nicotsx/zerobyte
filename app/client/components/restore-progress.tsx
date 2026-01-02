import { useEffect, useState } from "react";
import { ByteSize } from "~/client/components/bytes-size";
import { Card } from "~/client/components/ui/card";
import { Progress } from "~/client/components/ui/progress";
import { useServerEvents } from "~/client/hooks/use-server-events";
import type { RestoreCompletedEventDto, RestoreProgressEventDto } from "~/schemas/events-dto";
import { formatBytes } from "~/utils/format-bytes";
import { formatDuration } from "~/utils/utils";

type Props = {
	repositoryId: string;
	snapshotId: string;
};

export const RestoreProgress = ({ repositoryId, snapshotId }: Props) => {
	const { addEventListener } = useServerEvents();
	const [progress, setProgress] = useState<RestoreProgressEventDto | null>(null);

	useEffect(() => {
		const unsubscribe = addEventListener("restore:progress", (data) => {
			const progressData = data as RestoreProgressEventDto;
			if (progressData.repositoryId === repositoryId && progressData.snapshotId === snapshotId) {
				setProgress(progressData);
			}
		});

		const unsubscribeComplete = addEventListener("restore:completed", (data) => {
			const completedData = data as RestoreCompletedEventDto;
			if (completedData.repositoryId === repositoryId && completedData.snapshotId === snapshotId) {
				setProgress(null);
			}
		});

		return () => {
			unsubscribe();
			unsubscribeComplete();
		};
	}, [addEventListener, repositoryId, snapshotId]);

	if (!progress) {
		return (
			<Card className="p-4">
				<div className="flex items-center gap-2">
					<div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
					<span className="font-medium">Restore in progress</span>
				</div>
			</Card>
		);
	}

	const percentDone = Math.round(progress.percent_done * 100);
	const speed = formatBytes(progress.bytes_done / progress.seconds_elapsed);

	return (
		<Card className="p-4">
			<div className="flex items-center justify-between mb-4">
				<div className="flex items-center gap-2">
					<div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
					<span className="font-medium">Restore in progress</span>
				</div>
				<span className="text-sm font-medium text-primary">{percentDone}%</span>
			</div>

			<Progress value={percentDone} className="h-2 mb-4" />

			<div className="grid grid-cols-2 gap-4 text-sm">
				<div>
					<p className="text-xs uppercase text-muted-foreground">Files</p>
					<p className="font-medium">
						{progress.files_done.toLocaleString()} / {progress.total_files.toLocaleString()}
					</p>
				</div>
				<div>
					<p className="text-xs uppercase text-muted-foreground">Data</p>
					<p className="font-medium">
						<ByteSize bytes={progress.bytes_done} /> / <ByteSize bytes={progress.total_bytes} />
					</p>
				</div>
				<div>
					<p className="text-xs uppercase text-muted-foreground">Elapsed</p>
					<p className="font-medium">{formatDuration(progress.seconds_elapsed)}</p>
				</div>
				<div>
					<p className="text-xs uppercase text-muted-foreground">Speed</p>
					<p className="font-medium">
						{progress.seconds_elapsed > 0 ? `${speed.text} ${speed.unit}/s` : "Calculating..."}
					</p>
				</div>
			</div>
		</Card>
	);
};
