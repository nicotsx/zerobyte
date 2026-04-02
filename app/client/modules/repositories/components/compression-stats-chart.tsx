import { useMutation, useQuery } from "@tanstack/react-query";
import { Archive, RefreshCw } from "lucide-react";
import {
	getRepositoryStatsOptions,
	refreshRepositoryStatsMutation,
} from "~/client/api-client/@tanstack/react-query.gen";
import type { GetRepositoryStatsResponse } from "~/client/api-client/types.gen";
import { ByteSize } from "~/client/components/bytes-size";
import { useRootLoaderData } from "~/client/hooks/use-root-loader-data";
import { Button } from "~/client/components/ui/button";
import { Card, CardTitle } from "~/client/components/ui/card";
import { Separator } from "~/client/components/ui/separator";
import { parseError } from "~/client/lib/errors";
import { cn } from "~/client/lib/utils";
import { toast } from "sonner";

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
	const { locale } = useRootLoaderData();
	const refreshStats = useMutation({
		...refreshRepositoryStatsMutation(),
		onSuccess: () => {
			toast.success("Repository stats refreshed");
		},
		onError: (mutationError) => {
			toast.error("Failed to refresh repository stats", {
				description: parseError(mutationError)?.message,
			});
		},
	});

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

	const snapshotsCount = Math.round(toSafeNumber(stats?.snapshots_count));

	const hasStats = !!stats && (storedSize > 0 || uncompressedSize > 0 || snapshotsCount > 0);

	const storedPercent = Math.min(100, Math.max(0, uncompressedSize > 0 ? (storedSize / uncompressedSize) * 100 : 0));

	return (
		<Card className="flex flex-col px-6 py-6">
			<div className="flex items-start justify-between mb-5">
				<CardTitle className="flex items-center gap-2">
					<Archive className="h-4 w-4 text-muted-foreground" />
					Compression Statistics
				</CardTitle>
				<Button
					type="button"
					variant="outline"
					size="sm"
					onClick={() => refreshStats.mutate({ path: { shortId: repositoryShortId } })}
					disabled={refreshStats.isPending}
					title="Refresh statistics"
				>
					<RefreshCw className={cn("h-4 w-4", { "animate-spin": refreshStats.isPending })} />
				</Button>
			</div>
			<p className={cn("text-sm text-muted-foreground", { hidden: !isPending })}>Loading compression statistics...</p>
			<div className={cn("space-y-2", { hidden: !error || isPending })}>
				<p className="text-sm font-medium text-destructive">Failed to load compression statistics</p>
				<p className="text-sm text-muted-foreground wrap-break-word">{error?.message}</p>
			</div>
			<p className={cn("text-sm text-muted-foreground", { hidden: isPending || !!error || hasStats })}>
				Stats will be populated after your first backup. You can also refresh them manually.
			</p>
			<div className={cn({ hidden: isPending || !!error || !hasStats })}>
				<div className="mb-6">
					<div className="flex items-center justify-between text-sm mb-3">
						<span className="text-muted-foreground">
							<ByteSize base={1024} bytes={uncompressedSize} className="font-mono font-semibold text-foreground" /> of
							data across <span className="font-mono font-semibold text-foreground">{snapshotsCount}</span> snapshots
						</span>
					</div>
					<div className="h-9 rounded overflow-hidden flex">
						<div
							className="h-full bg-strong-accent/80 flex items-center px-3 text-xs font-medium text-white transition-all"
							style={{ width: `${storedPercent}%` }}
						>
							On disk
						</div>
						<div
							className={cn(
								"h-full bg-muted-foreground/10 flex items-center px-3 text-xs font-medium text-muted-foreground transition-all border-l border-border/30",
							)}
							style={{ width: `${100 - storedPercent}%` }}
						>
							<span className={cn({ hidden: storedPercent >= 80 })}>Freed by compression</span>
						</div>
					</div>
					<div className="flex items-center justify-between mt-2 text-sm">
						<ByteSize base={1024} bytes={storedSize} className="font-mono font-semibold" />
						<span className="font-mono text-muted-foreground">
							<ByteSize base={1024} bytes={savedSize} /> freed
						</span>
					</div>
				</div>
				<Separator className="mb-4" />
				<div className="flex items-center gap-6 text-sm">
					<div className="flex items-center gap-2">
						<span className="text-muted-foreground">Ratio</span>
						<span className="font-mono font-semibold">
							{compressionRatio > 0 ? `${compressionRatio.toFixed(2)}x` : "-"}
						</span>
					</div>
					<Separator orientation="vertical" className="h-4" />
					<div className="flex items-center gap-2">
						<span className="text-muted-foreground">Snapshots</span>
						<span className="font-mono font-semibold">{snapshotsCount.toLocaleString(locale)}</span>
					</div>
					<Separator orientation="vertical" className="h-4" />
					<div className="flex items-center gap-2">
						<span className="text-muted-foreground">Compressed</span>
						<span className="font-mono font-semibold">{compressionProgressPercent.toFixed(0)}%</span>
					</div>
				</div>
			</div>
		</Card>
	);
}
