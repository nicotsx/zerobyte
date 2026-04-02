import { Archive, Clock, FolderOpen, HardDrive, Lock, Settings, Shield } from "lucide-react";
import { Card, CardContent, CardTitle } from "~/client/components/ui/card";
import type { Repository } from "~/client/lib/types";
import type { GetRepositoryStatsResponse } from "~/client/api-client/types.gen";
import { formatDateTime, formatTimeAgo } from "~/client/lib/datetime";
import type { RepositoryConfig } from "@zerobyte/core/restic";
import { DoctorReport } from "../components/doctor-report";
import { CompressionStatsChart } from "../components/compression-stats-chart";
import { cn } from "~/client/lib/utils";

type Props = {
	repository: Repository;
	initialStats?: GetRepositoryStatsResponse;
};

const getEffectiveLocalPath = (repository: Repository): string | null => {
	if (repository.config.backend !== "local") return null;
	return repository.config.path;
};

type ConfigRowProps = { icon: React.ReactNode; label: string; value: string; mono?: boolean; valueClassName?: string };
function ConfigRow({ icon, label, value, mono, valueClassName }: ConfigRowProps) {
	return (
		<div className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
			<span className="text-muted-foreground shrink-0">{icon}</span>
			<span className="text-sm text-muted-foreground w-40 shrink-0">{label}</span>
			<span className={cn("text-sm break-all", { "font-mono bg-muted/50 px-2 py-0.5 rounded": mono }, valueClassName)}>
				{value}
			</span>
		</div>
	);
}

export const RepositoryInfoTabContent = ({ repository, initialStats }: Props) => {
	const effectiveLocalPath = getEffectiveLocalPath(repository);

	const config = repository.config as RepositoryConfig;
	const hasLocalPath = Boolean(effectiveLocalPath);
	const hasCaCert = Boolean(config.cacert);
	const hasInsecureTlsConfig = config.insecureTls !== undefined;

	return (
		<div className="flex flex-col gap-6 @container">
			<div className="grid grid-cols-1 @wide:grid-cols-2 gap-6">
				<CompressionStatsChart repositoryShortId={repository.shortId} initialStats={initialStats} />

				<Card className="px-6 py-6">
					<CardTitle className="mb-4">Overview</CardTitle>
					<CardContent className="grid grid-cols-2 gap-y-4 gap-x-6 px-0">
						<div className="flex flex-col gap-1">
							<div className="text-sm font-medium text-muted-foreground">Name</div>
							<p className="text-sm">{repository.name}</p>
						</div>
						<div className="flex flex-col gap-1">
							<div className="text-sm font-medium text-muted-foreground">Backend</div>
							<p className="text-sm">{repository.type}</p>
						</div>
						<div className="flex flex-col gap-1">
							<div className="text-sm font-medium text-muted-foreground">Management</div>
							<p className="text-sm">{repository.provisioningId ? "Provisioned" : "Manual"}</p>
						</div>
						<div className="flex flex-col gap-1">
							<div className="text-sm font-medium text-muted-foreground">Compression Mode</div>
							<p className="text-sm">{repository.compressionMode || "off"}</p>
						</div>
						<div className="flex flex-col gap-1">
							<div className="text-sm font-medium text-muted-foreground">Created</div>
							<p className="text-sm">{formatDateTime(repository.createdAt)}</p>
						</div>
						<div className="flex flex-col gap-1">
							<div className="text-sm font-medium text-muted-foreground">Last Checked</div>
							<p className="text-sm flex items-center gap-1.5">
								<Clock className="h-3 w-3 text-muted-foreground" />
								{formatTimeAgo(repository.lastChecked)}
							</p>
						</div>
						{hasLocalPath && (
							<div className="flex flex-col gap-1 col-span-2">
								<div className="text-sm font-medium text-muted-foreground">Local Path</div>
								<p className="text-sm font-mono bg-muted/50 p-2 rounded-md break-all">{effectiveLocalPath}</p>
							</div>
						)}
					</CardContent>
				</Card>
			</div>

			<Card className="px-6 py-6">
				<CardTitle className="flex items-center gap-2 mb-5">
					<Settings className="h-4 w-4 text-muted-foreground" />
					Configuration
				</CardTitle>
				<div className="space-y-0 divide-y divide-border/50">
					<ConfigRow icon={<HardDrive className="h-4 w-4" />} label="Backend" value={repository.type} />
					{hasLocalPath && (
						<ConfigRow icon={<FolderOpen className="h-4 w-4" />} label="Local Path" value={effectiveLocalPath!} mono />
					)}
					<ConfigRow
						icon={<Archive className="h-4 w-4" />}
						label="Compression Mode"
						value={repository.compressionMode || "off"}
					/>
					{hasCaCert && (
						<ConfigRow
							icon={<Lock className="h-4 w-4" />}
							label="CA Certificate"
							value="Configured"
							valueClassName="text-success"
						/>
					)}
					{hasInsecureTlsConfig && (
						<ConfigRow
							icon={<Shield className="h-4 w-4" />}
							label="TLS Validation"
							value={config.insecureTls ? "Disabled" : "Enabled"}
							valueClassName={config.insecureTls ? "text-red-500" : "text-success"}
						/>
					)}
				</div>
			</Card>

			<DoctorReport repositoryStatus={repository.status} result={repository.doctorResult} />
		</div>
	);
};
