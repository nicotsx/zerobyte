import { useQuery } from "@tanstack/react-query";
import { Archive } from "lucide-react";
import { getRepositoryStatsOptions } from "~/client/api-client/@tanstack/react-query.gen";
import { ByteSize } from "~/client/components/bytes-size";
import { Card, CardContent, CardHeader, CardTitle } from "~/client/components/ui/card";

type Props = {
	repositoryShortId: string;
};

const toSafeNumber = (value: number | undefined) => {
	if (typeof value !== "number" || !Number.isFinite(value)) {
		return 0;
	}

	return Math.max(0, value);
};

export function CompressionStatsChart({ repositoryShortId }: Props) {
	const {
		data: stats,
		isLoading,
		error,
	} = useQuery({
		...getRepositoryStatsOptions({ path: { shortId: repositoryShortId } }),
		retry: false,
	});

	const storedSize = toSafeNumber(stats?.total_size);
	const uncompressedSize = toSafeNumber(stats?.total_uncompressed_size);
	const savedSize = uncompressedSize > storedSize ? uncompressedSize - storedSize : 0;

	const compressionRatio = toSafeNumber(stats?.compression_ratio);

	const rawCompressionProgress = toSafeNumber(stats?.compression_progress);
	const compressionProgressPercent = Math.min(100, Math.max(0, rawCompressionProgress));

	const spaceSavingPercent = toSafeNumber(stats?.compression_space_saving);
	const snapshotsCount = Math.round(toSafeNumber(stats?.snapshots_count));

	const hasStats = !!stats && (storedSize > 0 || uncompressedSize > 0 || snapshotsCount > 0);

	if (isLoading) {
		return (
			<Card className="p-6">
				<p className="text-sm text-muted-foreground">Loading compression statistics...</p>
			</Card>
		);
	}

	if (error) {
		return (
			<Card className="p-6">
				<p className="text-sm font-medium text-destructive">Failed to load compression statistics</p>
				<p className="mt-2 text-sm text-muted-foreground wrap-break-word">{error.message}</p>
			</Card>
		);
	}

	if (!hasStats) {
		return (
			<Card className="p-6">
				<p className="text-sm text-muted-foreground">
					No compression statistics available yet. Run a backup to populate repository stats.
				</p>
			</Card>
		);
	}

	return (
		<Card className="flex flex-col h-full">
			<CardHeader className="pb-4">
				<CardTitle className="flex items-center gap-2 text-base font-semibold">
					<Archive className="h-4 w-4" />
					Compression Statistics
				</CardTitle>
			</CardHeader>
			<CardContent className="flex-1">
				<div className="grid grid-cols-2 md:grid-cols-3 gap-y-6 gap-x-6">
					<div className="flex flex-col gap-1.5">
						<div className="flex items-center gap-2 text-muted-foreground">
							<span className="text-xs font-medium uppercase tracking-wider">Stored Size</span>
						</div>
						<div className="flex items-baseline gap-2">
							<ByteSize base={1024} bytes={storedSize} className="text-2xl font-bold font-mono text-foreground" />
						</div>
					</div>

					<div className="flex flex-col gap-1.5">
						<div className="flex items-center gap-2 text-muted-foreground">
							<span className="text-xs font-medium uppercase tracking-wider">Uncompressed</span>
						</div>
						<div className="flex items-baseline gap-2">
							<ByteSize base={1024} bytes={uncompressedSize} className="text-2xl font-bold font-mono text-foreground" />
						</div>
					</div>

					<div className="flex flex-col gap-1.5">
						<div className="flex items-center gap-2 text-muted-foreground">
							<span className="text-xs font-medium uppercase tracking-wider">Space Saved</span>
						</div>
						<div className="flex items-baseline gap-2">
							<span className="text-2xl font-bold font-mono text-foreground">{spaceSavingPercent.toFixed(1)}%</span>
							<ByteSize base={1024} bytes={savedSize} className="text-sm text-muted-foreground font-mono" />
						</div>
					</div>

					<div className="flex flex-col gap-1.5">
						<div className="flex items-center gap-2 text-muted-foreground">
							<span className="text-xs font-medium uppercase tracking-wider">Ratio</span>
						</div>
						<div className="flex items-baseline gap-2">
							<span className="text-2xl font-bold font-mono text-foreground">
								{compressionRatio > 0 ? `${compressionRatio.toFixed(2)}x` : "—"}
							</span>
						</div>
					</div>

					<div className="flex flex-col gap-1.5">
						<div className="flex items-center gap-2 text-muted-foreground">
							<span className="text-xs font-medium uppercase tracking-wider">Snapshots</span>
						</div>
						<div className="flex items-baseline gap-2">
							<span className="text-2xl font-bold font-mono text-foreground">{snapshotsCount.toLocaleString()}</span>
							<span className="text-sm text-muted-foreground font-mono">
								{compressionProgressPercent.toFixed(1)}% compressed
							</span>
						</div>
					</div>
				</div>
			</CardContent>
		</Card>
	);
}
