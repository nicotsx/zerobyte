import type { ListTasksResponse } from "~/client/api-client";
import { ByteSize } from "~/client/components/bytes-size";
import { useFormatBytes } from "~/client/hooks/use-format-bytes";
import { useRootLoaderData } from "~/client/hooks/use-root-loader-data";
import { Card } from "~/client/components/ui/card";
import { Progress } from "~/client/components/ui/progress";
import { formatDuration } from "~/client/lib/datetime";

type RestoreTaskProgress = Extract<NonNullable<ListTasksResponse[number]["progress"]>, { kind: "restore" }>["progress"];

type Props = {
	progress: RestoreTaskProgress | null;
};

export const RestoreProgress = ({ progress }: Props) => {
	const formatBytes = useFormatBytes();
	const { locale } = useRootLoaderData();

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

	const secondsElapsed = progress.seconds_elapsed ?? 0;
	const totalFiles = progress.total_files ?? 0;
	const filesRestored = progress.files_restored ?? 0;
	const totalBytes = progress.total_bytes ?? 0;
	const bytesRestored = progress.bytes_restored ?? 0;
	const fileProgress = totalFiles > 0 ? filesRestored / totalFiles : 0;
	const reportedProgress = progress.percent_done ?? 0;
	const progressFraction = reportedProgress > 0 ? reportedProgress : fileProgress;
	const percentDone = Math.round(Math.min(progressFraction, 1) * 100);
	const speed = secondsElapsed > 0 ? formatBytes(bytesRestored / secondsElapsed) : null;

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
						{filesRestored.toLocaleString(locale)}
						&nbsp;/&nbsp;
						{totalFiles.toLocaleString(locale)}
					</p>
				</div>
				<div>
					<p className="text-xs uppercase text-muted-foreground">Data</p>
					<p className="font-medium">
						<ByteSize bytes={bytesRestored} base={1024} />
						&nbsp;/&nbsp;
						<ByteSize bytes={totalBytes} base={1024} />
					</p>
				</div>
				<div>
					<p className="text-xs uppercase text-muted-foreground">Elapsed</p>
					<p className="font-medium">{formatDuration(secondsElapsed)}</p>
				</div>
				<div>
					<p className="text-xs uppercase text-muted-foreground">Speed</p>
					<p className="font-medium">{speed ? `${speed.text} ${speed.unit}/s` : "Calculating..."}</p>
				</div>
			</div>
		</Card>
	);
};
