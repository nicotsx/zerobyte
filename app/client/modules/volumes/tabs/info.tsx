import { useMemo } from "react";
import { FolderOpen, HardDrive, Settings, Unplug } from "lucide-react";
import { Label, Pie, PieChart } from "recharts";
import { ByteSize } from "~/client/components/bytes-size";
import { Card, CardTitle } from "~/client/components/ui/card";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "~/client/components/ui/chart";
import type { StatFs, Volume } from "~/client/lib/types";
import { cn } from "~/client/lib/utils";

type Props = {
	volume: Volume;
	statfs: StatFs;
};

const backendLabels: Record<Volume["type"], string> = {
	directory: "Directory",
	nfs: "NFS",
	smb: "SMB",
	webdav: "WebDAV",
	rclone: "rclone",
	sftp: "SFTP",
};

type ConfigRowProps = {
	icon: React.ReactNode;
	label: string;
	value: string;
	mono?: boolean;
};

function ConfigRow({ icon, label, value, mono }: ConfigRowProps) {
	return (
		<div className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
			<span className="text-muted-foreground shrink-0">{icon}</span>
			<span className="text-sm text-muted-foreground w-40 shrink-0">{label}</span>
			<span className={cn("text-sm break-all", { "font-mono bg-muted/50 px-2 py-0.5 rounded": mono })}>{value}</span>
		</div>
	);
}

function BackendConfigRows({ volume }: { volume: Volume }) {
	const config = volume.config;

	switch (config.backend) {
		case "directory":
			return <ConfigRow icon={<FolderOpen className="h-4 w-4" />} label="Directory Path" value={config.path} mono />;
		case "nfs":
			return (
				<>
					<ConfigRow icon={<FolderOpen className="h-4 w-4" />} label="Server" value={config.server} mono />
					<ConfigRow icon={<FolderOpen className="h-4 w-4" />} label="Export Path" value={config.exportPath} mono />
				</>
			);
		case "smb":
			return (
				<>
					<ConfigRow icon={<FolderOpen className="h-4 w-4" />} label="Server" value={config.server} mono />
					<ConfigRow icon={<FolderOpen className="h-4 w-4" />} label="Share" value={config.share} mono />
				</>
			);
		case "webdav":
			return (
				<>
					<ConfigRow icon={<FolderOpen className="h-4 w-4" />} label="Server" value={config.server} mono />
					<ConfigRow icon={<FolderOpen className="h-4 w-4" />} label="Path" value={config.path} mono />
				</>
			);
		case "rclone":
			return (
				<>
					<ConfigRow icon={<FolderOpen className="h-4 w-4" />} label="Remote" value={config.remote} mono />
					<ConfigRow icon={<FolderOpen className="h-4 w-4" />} label="Path" value={config.path} mono />
				</>
			);
		case "sftp":
			return (
				<>
					<ConfigRow icon={<FolderOpen className="h-4 w-4" />} label="Host" value={config.host} mono />
					<ConfigRow icon={<FolderOpen className="h-4 w-4" />} label="Username" value={config.username} />
					<ConfigRow icon={<FolderOpen className="h-4 w-4" />} label="Path" value={config.path} mono />
				</>
			);
	}
}

function DonutChart({ statfs }: { statfs: StatFs }) {
	const chartData = useMemo(
		() => [
			{ name: "Used", value: statfs.used, fill: "var(--strong-accent)" },
			{ name: "Free", value: statfs.free, fill: "lightgray" },
		],
		[statfs],
	);

	const usagePercentage = useMemo(() => {
		return Math.round((statfs.used / statfs.total) * 100);
	}, [statfs]);

	return (
		<ChartContainer config={{}} className="mx-auto aspect-square max-h-[200px]">
			<PieChart>
				<ChartTooltip
					cursor={false}
					content={
						<ChartTooltipContent
							hideLabel
							formatter={(value, name) => [<ByteSize key={name} bytes={value as number} />, name]}
						/>
					}
				/>
				<Pie data={chartData} dataKey="value" nameKey="name" innerRadius={50} strokeWidth={5}>
					<Label
						content={({ viewBox }) => {
							if (viewBox && "cx" in viewBox && "cy" in viewBox) {
								return (
									<text x={viewBox.cx} y={viewBox.cy} textAnchor="middle" dominantBaseline="middle">
										<tspan x={viewBox.cx} y={viewBox.cy} className="fill-foreground text-2xl font-bold">
											{usagePercentage}%
										</tspan>
										<tspan x={viewBox.cx} y={(viewBox.cy || 0) + 20} className="fill-muted-foreground text-xs">
											Used
										</tspan>
									</text>
								);
							}
						}}
					/>
				</Pie>
			</PieChart>
		</ChartContainer>
	);
}

export const VolumeInfoTabContent = ({ volume, statfs }: Props) => {
	const hasStorage = statfs.total > 0;

	return (
		<Card className="px-6 py-6 @container/inner">
			<div className="grid grid-cols-1 @3xl/inner:grid-cols-[1fr_280px] gap-8">
				<div>
					<CardTitle className="flex items-center gap-2 mb-5">
						<Settings className="h-4 w-4 text-muted-foreground" />
						Configuration
					</CardTitle>
					<div className="space-y-0 divide-y divide-border/50">
						<ConfigRow icon={<HardDrive className="h-4 w-4" />} label="Name" value={volume.name} />
						<ConfigRow icon={<HardDrive className="h-4 w-4" />} label="Backend" value={backendLabels[volume.type]} />
						<BackendConfigRows volume={volume} />
					</div>
				</div>

				{hasStorage ? (
					<div className="@3xl/inner:border-l @3xl/inner:border-border/50 @3xl/inner:pl-8">
						<CardTitle className="flex items-center gap-2 mb-2 text-center @3xl/inner:text-left">
							<HardDrive className="h-4 w-4" />
							Storage
						</CardTitle>
						<DonutChart statfs={statfs} />
						<div className="grid gap-2 mt-2">
							<div className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
								<div className="flex items-center gap-3">
									<HardDrive className="h-4 w-4 text-muted-foreground" />
									<span className="text-sm font-medium">Total</span>
								</div>
								<ByteSize bytes={statfs.total} className="font-mono text-sm" />
							</div>
							<div className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
								<div className="flex items-center gap-3">
									<div className="h-3 w-3 rounded-full bg-strong-accent" />
									<span className="text-sm font-medium">Used</span>
								</div>
								<ByteSize bytes={statfs.used} className="font-mono text-sm" />
							</div>
							<div className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
								<div className="flex items-center gap-3">
									<div className="h-3 w-3 rounded-full bg-primary" />
									<span className="text-sm font-medium">Free</span>
								</div>
								<ByteSize bytes={statfs.free} className="font-mono text-sm" />
							</div>
						</div>
					</div>
				) : (
					<div className="@3xl/inner:border-l @3xl/inner:border-border/50 @3xl/inner:pl-8 flex flex-col items-center justify-center text-center py-8">
						<Unplug className="mb-4 h-5 w-5 text-muted-foreground" />
						<p className="text-sm text-muted-foreground">
							No storage data available.
							<br />
							Mount the volume to see usage.
						</p>
					</div>
				)}
			</div>
		</Card>
	);
};
