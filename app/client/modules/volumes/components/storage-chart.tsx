"use client";

import { HardDrive, Unplug } from "lucide-react";
import * as React from "react";
import { Label, Pie, PieChart } from "recharts";
import { ByteSize } from "~/client/components/bytes-size";
import { Card, CardContent, CardHeader, CardTitle } from "~/client/components/ui/card";
import { type ChartConfig, ChartContainer, ChartTooltip, ChartTooltipContent } from "~/client/components/ui/chart";
import type { StatFs } from "~/client/lib/types";

type Props = {
	statfs: StatFs;
};

export function StorageChart({ statfs }: Props) {
	const chartData = React.useMemo(
		() => [
			{
				name: "Used",
				value: statfs.used,
				fill: "#ff543a",
			},
			{
				name: "Free",
				value: statfs.free,
				fill: "lightgray",
			},
		],
		[statfs],
	);

	const chartConfig = {} satisfies ChartConfig;

	const usagePercentage = React.useMemo(() => {
		return Math.round((statfs.used / statfs.total) * 100);
	}, [statfs]);

	const isEmpty = !statfs.total;

	if (isEmpty) {
		return (
			<Card className="flex flex-col h-full text-sm">
				<CardHeader className="items-center pb-0">
					<CardTitle className="flex items-center gap-2">
						<HardDrive className="h-4 w-4" />
						Storage Usage
					</CardTitle>
				</CardHeader>
				<CardContent className="flex-1 pb-10 flex flex-col items-center justify-center text-center">
					<Unplug className="mb-4 h-5 w-5 text-muted-foreground" />
					<p className="text-muted-foreground">No storage data available. Mount the volume to see usage statistics.</p>
				</CardContent>
			</Card>
		);
	}

	return (
		<Card className="flex flex-col h-full text-sm">
			<CardHeader className="items-center pb-0">
				<CardTitle className="flex items-center gap-2">
					<HardDrive className="h-4 w-4" />
					Storage Usage
				</CardTitle>
			</CardHeader>
			<CardContent className="flex-1 pb-0">
				<div>
					<ChartContainer config={chartConfig} className="mx-auto aspect-square max-h-[250px]">
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
							<Pie data={chartData} dataKey="value" nameKey="name" innerRadius={60} strokeWidth={5}>
								<Label
									content={({ viewBox }) => {
										if (viewBox && "cx" in viewBox && "cy" in viewBox) {
											return (
												<text x={viewBox.cx} y={viewBox.cy} textAnchor="middle" dominantBaseline="middle">
													<tspan x={viewBox.cx} y={viewBox.cy} className="fill-foreground text-3xl font-bold">
														{usagePercentage}%
													</tspan>
													<tspan x={viewBox.cx} y={(viewBox.cy || 0) + 24} className="fill-muted-foreground">
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
					<div className="flex flex-col h-full justify-center">
						<div className="grid gap-4 w-full">
							<div className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
								<div className="flex items-center gap-3">
									<HardDrive className="h-4 w-4 text-muted-foreground" />
									<span className="font-medium">Total capacity</span>
								</div>
								<ByteSize bytes={statfs.total} className="font-mono text-sm" />
							</div>

							<div className="flex items-center justify-between p-3 rounded-lg bg-strong-accent/10">
								<div className="flex items-center gap-3">
									<div className="h-4 w-4 rounded-full bg-strong-accent" />
									<span className="font-medium">Used space</span>
								</div>
								<div className="text-right">
									<ByteSize bytes={statfs.used} className="font-mono text-sm" />
								</div>
							</div>

							<div className="flex items-center justify-between p-3 rounded-lg bg-primary/10">
								<div className="flex items-center gap-3">
									<div className="h-4 w-4 rounded-full bg-primary" />
									<span className="font-medium">Free space</span>
								</div>
								<div className="text-right">
									<ByteSize bytes={statfs.free} className="font-mono text-sm" />
								</div>
							</div>
						</div>
					</div>
				</div>
			</CardContent>
		</Card>
	);
}
