import { useId } from "react";
import { ByteSize } from "~/client/components/bytes-size";
import { useFormatBytes } from "~/client/hooks/use-format-bytes";
import { useRootLoaderData } from "~/client/hooks/use-root-loader-data";
import { Card } from "~/client/components/ui/card";
import { Progress } from "~/client/components/ui/progress";
import type { BackupTask } from "../backup-tasks";
import { formatDuration } from "~/client/lib/datetime";
import { getActiveBackupPercent, hasCoherentBackupEta } from "./backup-progress";

type Props = {
	progress: NonNullable<BackupTask["progress"]>["progress"] | null;
};

export const BackupProgressCard = ({ progress }: Props) => {
	const formatBytes = useFormatBytes();
	const { locale } = useRootLoaderData();
	const progressHeadingId = useId();

	const {
		percent_done = 0,
		bytes_done = 0,
		total_bytes = 0,
		seconds_elapsed = 0,
		files_done = 0,
		total_files = 0,
	} = progress ?? {};

	const percentDone = progress ? getActiveBackupPercent(percent_done) : 0;
	const currentFile = progress?.current_files?.[0] || "";
	const fileName = currentFile.split("/").pop() || currentFile;
	const hasElapsedTime = Number.isFinite(seconds_elapsed) && seconds_elapsed > 0;
	const bytesPerSecond = hasElapsedTime ? bytes_done / seconds_elapsed : 0;
	const speed = hasElapsedTime && Number.isFinite(bytesPerSecond) ? formatBytes(bytesPerSecond) : null;
	const secondsRemaining = progress?.seconds_remaining ?? 0;
	const hasCoherentEta = hasCoherentBackupEta({
		bytesDone: bytes_done,
		totalBytes: total_bytes,
		secondsElapsed: seconds_elapsed,
		secondsRemaining,
	});
	const eta = hasCoherentEta ? formatDuration(secondsRemaining) : null;
	const isFinitePercent = Number.isFinite(percent_done);
	const isScanningForMoreData = progress !== null && isFinitePercent && percent_done >= 1;
	const progressLabel = isScanningForMoreData ? `${percentDone}% · scanning` : `${percentDone}%`;

	return (
		<Card className="p-4">
			<div className="flex items-center justify-between">
				<div className="flex items-center gap-2">
					<div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
					<h2 id={progressHeadingId} className="font-medium">
						Backup in progress
					</h2>
				</div>
				<span className="text-sm font-medium text-primary">{progress ? progressLabel : "—"}</span>
			</div>

			<Progress aria-labelledby={progressHeadingId} value={percentDone} className="h-2" />

			<div className="grid grid-cols-2 gap-4 text-sm">
				<div>
					<p className="text-xs uppercase text-muted-foreground">Files processed</p>
					<p className="font-medium">{progress ? <>{files_done.toLocaleString(locale)} processed</> : "—"}</p>
					{progress && (
						<p className="text-xs text-muted-foreground">
							{total_files.toLocaleString(locale)} discovered so far
						</p>
					)}
				</div>
				<div>
					<p className="text-xs uppercase text-muted-foreground">Data processed</p>
					<p className="font-medium">
						{progress ? (
							<>
								<ByteSize bytes={bytes_done} base={1024} />
								&nbsp;processed
							</>
						) : (
							"—"
						)}
					</p>
					{progress && (
						<p className="text-xs text-muted-foreground">
							<ByteSize bytes={total_bytes} base={1024} /> discovered so far
						</p>
					)}
				</div>
				<div>
					<p className="text-xs uppercase text-muted-foreground">Elapsed</p>
					<p className="font-medium">{progress ? formatDuration(seconds_elapsed) : "—"}</p>
				</div>
				<div>
					<p className="text-xs uppercase text-muted-foreground">Processing speed</p>
					<p className="font-medium">
						{progress ? (speed ? `${speed.text} ${speed.unit}/s` : "Calculating...") : "—"}
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
