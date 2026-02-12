import { Card, CardContent } from "~/client/components/ui/card";
import { ByteSize } from "~/client/components/bytes-size";
import { formatDuration } from "~/utils/utils";

type BackupSummary = {
	backup_start: string;
	backup_end: string;
	files_new: number;
	files_changed: number;
	files_unmodified: number;
	dirs_new: number;
	dirs_changed: number;
	dirs_unmodified: number;
	data_blobs: number;
	tree_blobs: number;
	data_added: number;
	data_added_packed?: number | null;
	total_files_processed: number;
	total_bytes_processed: number;
};

type Props = {
	summary?: BackupSummary | null;
};

const formatCount = (value: number) => value.toLocaleString();

const getDurationLabel = (start: string, end: string) => {
	const startMs = new Date(start).getTime();
	const endMs = new Date(end).getTime();
	if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs) return "-";
	return formatDuration(Math.round((endMs - startMs) / 1000));
};

export const BackupSummaryCard = ({ summary }: Props) => {
	if (!summary) return null;

	const durationLabel = getDurationLabel(summary.backup_start, summary.backup_end);

	const topStats = [
		{
			label: "Data added",
			value: <ByteSize bytes={summary.data_added} base={1024} />,
		},
		{
			label: "Data stored",
			value: <ByteSize bytes={summary.data_added_packed ?? 0} base={1024} />,
		},
		{
			label: "Files processed",
			value: formatCount(summary.total_files_processed),
		},
		{
			label: "Bytes processed",
			value: <ByteSize bytes={summary.total_bytes_processed} base={1024} />,
		},
		{
			label: "Duration",
			value: durationLabel,
		},
	];

	const detailStats = [
		{ label: "New files", value: formatCount(summary.files_new) },
		{ label: "Changed files", value: formatCount(summary.files_changed) },
		{ label: "Unmodified files", value: formatCount(summary.files_unmodified) },
		{ label: "New dirs", value: formatCount(summary.dirs_new) },
		{ label: "Changed dirs", value: formatCount(summary.dirs_changed) },
		{ label: "Unmodified dirs", value: formatCount(summary.dirs_unmodified) },
		{ label: "Data blobs", value: formatCount(summary.data_blobs) },
		{ label: "Tree blobs", value: formatCount(summary.tree_blobs) },
	];

	return (
		<Card className="p-4">
			<CardContent className="px-4">
				<div className="grid gap-6 grid-cols-2 lg:grid-cols-5">
					{topStats.map((stat) => (
						<div key={stat.label} className="flex flex-col gap-1">
							<span className="text-[11px] uppercase tracking-wide text-muted-foreground">{stat.label}</span>
							<span className="text-sm font-semibold text-foreground">{stat.value}</span>
						</div>
					))}
				</div>
				<div className="mt-4 border-t border-border/60 pt-3">
					<div className="grid gap-x-6 gap-y-2 grid-cols-2 lg:grid-cols-4">
						{detailStats.map((stat) => (
							<div key={stat.label} className="flex items-center justify-start text-xs gap-2">
								<span className="font-semibold text-foreground">{stat.value}</span>
								<span className="text-muted-foreground">{stat.label}</span>
							</div>
						))}
					</div>
				</div>
			</CardContent>
		</Card>
	);
};
