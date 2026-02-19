"use client";

import { Label, Pie, PieChart } from "recharts";
import { ByteSize } from "~/client/components/bytes-size";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "~/client/components/ui/chart";
import type { ChartConfig } from "~/client/components/ui/chart";

type CompressionChartProps = {
	chartData: Array<{ name: string; value: number; fill: string }>;
	chartConfig: ChartConfig;
	compressionRatio: number;
};

export default function CompressionChart({ chartData, chartConfig, compressionRatio }: CompressionChartProps) {
	return (
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
				<Pie data={chartData} dataKey="value" nameKey="name" innerRadius={65} strokeWidth={5}>
					<Label
						content={({ viewBox }) => {
							if (viewBox && "cx" in viewBox && "cy" in viewBox) {
								return (
									<text x={viewBox.cx} y={viewBox.cy} textAnchor="middle" dominantBaseline="middle">
										<tspan x={viewBox.cx} y={viewBox.cy} className="fill-foreground text-3xl font-bold">
											{compressionRatio > 0 ? `${compressionRatio.toFixed(1)}x` : "—"}
										</tspan>
										<tspan x={viewBox.cx} y={(viewBox.cy || 0) + 24} className="fill-muted-foreground">
											Compression
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
