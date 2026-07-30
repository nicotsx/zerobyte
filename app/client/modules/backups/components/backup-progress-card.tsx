import { ByteSize } from "~/client/components/bytes-size";
import { useFormatBytes } from "~/client/hooks/use-format-bytes";
import { useRootLoaderData } from "~/client/hooks/use-root-loader-data";
import { Card } from "~/client/components/ui/card";
import { Progress } from "~/client/components/ui/progress";
import type { BackupTask } from "../backup-tasks";
import { formatDuration } from "~/client/lib/datetime";

type Props = {
	progress: NonNullable<BackupTask["progress"]>["progress"] | null;
};

export const BackupProgressCard = ({ progress }: Props) => {
	const formatBytes = useFormatBytes();
	const { locale } = useRootLoaderData();

	const {
		percent_done = 0,
		bytes_done = 0,
		total_bytes = 0,
		seconds_elapsed = 0,
		files_done = 0,
		total_files = 0,
	} = progress ?? {};

	const percentDone = progress ? Math.round(percent_done * 100) : 0;
	const currentFile = progress?.current_files?.[0] || "";
	const fileName = currentFile.split("/").pop() || currentFile;
	const speed = progress ? formatBytes(bytes_done / seconds_elapsed) : null;
	const eta = progress?.seconds_remaining ? formatDuration(progress.seconds_remaining) : null;

	return (
		<Card className="p-4">
			<div className="flex items-center justify-between">
				<div className="flex items-center gap-2">
					<div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
					<span className="font-medium">Backup in progress</span>
				</div>
				<span className="text-sm font-medium text-primary">{progress ? `${percentDone}%` : "—"}</span>
			</div>

			<Progress value={percentDone} className="h-2" />

			<div className="grid grid-cols-2 gap-4 text-sm">
				<div>
					<p className="text-xs uppercase text-muted-foreground">Files</p>
					<p className="font-medium">
						{progress ? (
							<>
								{files_done.toLocaleString(locale)} / {total_files.toLocaleString(locale)}
							</>
						) : (
							"—"
						)}
					</p>
				</div>
				<div>
					<p className="text-xs uppercase text-muted-foreground">Data</p>
					<p className="font-medium">
						{progress ? (
							<>
								<ByteSize bytes={bytes_done} base={1024} />
								&nbsp;/&nbsp;
								<ByteSize bytes={total_bytes} base={1024} />
							</>
						) : (
							"—"
						)}
					</p>
				</div>
				<div>
					<p className="text-xs uppercase text-muted-foreground">Elapsed</p>
					<p className="font-medium">{progress ? formatDuration(seconds_elapsed) : "—"}</p>
				</div>
				<div>
					<p className="text-xs uppercase text-muted-foreground">Speed</p>
					<p className="font-medium">
						{progress ? (seconds_elapsed > 0 ? `${speed?.text} ${speed?.unit}/s` : "Calculating...") : "—"}
					</p>
				</div>
				<div>
					<p className="text-xs uppercase text-muted-foreground">ETA</p>
					<p className="font-medium">{progress ? (eta ?? "Calculating...") : "—"}</p>
				</div>
			</div>

			<div className="pt-2 border-t border-border">
				<p className="text-xs uppercase text-muted-foreground mb-1">Current file</p>
				<p className="text-xs font-mono text-muted-foreground truncate" title={currentFile || undefined}>
					{fileName || "—"}
				</p>
			</div>
		</Card>
	);
};
