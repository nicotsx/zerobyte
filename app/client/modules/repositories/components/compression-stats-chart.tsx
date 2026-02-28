import { useQuery } from "@tanstack/react-query";
import { Archive } from "lucide-react";
import { getRepositoryStatsOptions } from "~/client/api-client/@tanstack/react-query.gen";
import { ByteSize } from "~/client/components/bytes-size";
import { Card, CardContent, CardTitle } from "~/client/components/ui/card";
import type { GetRepositoryStatsResponse } from "~/client/api-client/types.gen";

type Props = {
	repositoryShortId: string;
	initialStats?: GetRepositoryStatsResponse;
};

const toSafeNumber = (value: number | undefined) => {
	if (typeof value !== "number" || !Number.isFinite(value)) {
		return 0;
	}

	return Math.max(0, value);
};

export function CompressionStatsChart({ repositoryShortId, initialStats }: Props) {
	const {
		data: stats,
		isPending,
		error,
	} = useQuery({
		...getRepositoryStatsOptions({ path: { shortId: repositoryShortId } }),
		retry: false,
		initialData: initialStats,
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

	if (isPending) {
		return (
			<Card className="p-6">
				<p className="text-sm text-muted-foreground">Loading compression statistics...</p>
			</Card>
		);
	}

	if (error) {
		return (
			<Card className="p-6 border-red-500/20 bg-red-500/5">
				<p className="text-sm font-medium text-red-500">Failed to load compression statistics</p>
				<p className="mt-2 text-sm text-red-500/80 wrap-break-word">{error.message}</p>
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
		<Card className="flex flex-col px-6 py-6">
			<div className="pb-4">
				<CardTitle className="flex items-center gap-2">
					<Archive className="h-5 w-5 text-muted-foreground" />
					Compression Statistics
				</CardTitle>
			</div>
			<div>
				<CardContent className="grid grid-cols-2 lg:grid-cols-3 gap-y-6 gap-x-4 px-0">
					<div className="flex flex-col gap-1.5">
						<div className="text-sm font-medium text-muted-foreground">Stored Size</div>
						<div className="flex items-baseline gap-2">
							<ByteSize base={1024} bytes={storedSize} className="text-xl font-semibold text-foreground font-mono" />
						</div>
					</div>

					<div className="flex flex-col gap-1.5">
						<div className="text-sm font-medium text-muted-foreground">Uncompressed</div>
						<div className="flex items-baseline gap-2">
							<ByteSize
								base={1024}
								bytes={uncompressedSize}
								className="text-xl font-semibold text-foreground font-mono"
							/>
						</div>
					</div>

					<div className="flex flex-col gap-1.5">
						<div className="text-sm font-medium text-muted-foreground">Space Saved</div>
						<div className="flex items-baseline gap-2">
							<span className="text-xl font-semibold text-foreground font-mono">{spaceSavingPercent.toFixed(1)}%</span>
							<ByteSize base={1024} bytes={savedSize} className="text-xs text-muted-foreground font-mono" />
						</div>
					</div>

					<div className="flex flex-col gap-1.5">
						<div className="text-sm font-medium text-muted-foreground">Ratio</div>
						<div className="flex items-baseline gap-2">
							<span className="text-xl font-semibold text-foreground font-mono">
								{compressionRatio > 0 ? `${compressionRatio.toFixed(2)}x` : "—"}
							</span>
						</div>
					</div>

					<div className="flex flex-col gap-1.5 lg:col-span-2">
						<div className="text-sm font-medium text-muted-foreground">Snapshots</div>
						<div className="flex items-baseline gap-2">
							<span className="text-xl font-semibold text-foreground font-mono">{snapshotsCount.toLocaleString()}</span>
							<span className="text-xs text-muted-foreground font-mono">
								{compressionProgressPercent.toFixed(1)}% compressed
							</span>
						</div>
					</div>
				</CardContent>
			</div>
		</Card>
	);
}
