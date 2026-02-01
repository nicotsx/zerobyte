import { useQuery } from "@tanstack/react-query";
import { listRepositoriesOptions } from "~/client/api-client/@tanstack/react-query.gen";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/client/components/ui/card";
import type { Volume } from "~/client/lib/types";
import type { InternalFormValues } from "./types";

type SummarySectionProps = {
	volume: Volume;
	frequency: string;
	formValues: InternalFormValues;
};

export const SummarySection = ({ volume, frequency, formValues }: SummarySectionProps) => {
	const { data: repositoriesData } = useQuery({
		...listRepositoriesOptions(),
	});

	return (
		<Card>
			<CardHeader className="flex flex-row items-center justify-between gap-4">
				<div>
					<CardTitle>Schedule summary</CardTitle>
					<CardDescription>Review the backup configuration.</CardDescription>
				</div>
			</CardHeader>
			<CardContent className="flex flex-col gap-4 text-sm">
				<div>
					<p className="text-xs uppercase text-muted-foreground">Volume</p>
					<p className="font-medium">{volume.name}</p>
				</div>
				<div>
					<p className="text-xs uppercase text-muted-foreground">Schedule</p>
					<p className="font-medium">{frequency ? frequency.charAt(0).toUpperCase() + frequency.slice(1) : "-"}</p>
				</div>
				<div>
					<p className="text-xs uppercase text-muted-foreground">Repository</p>
					<p className="font-medium">{repositoriesData?.find((r) => r.id === formValues.repositoryId)?.name || "—"}</p>
				</div>
				{(formValues.includePatterns && formValues.includePatterns.length > 0) || formValues.includePatternsText ? (
					<div>
						<p className="text-xs uppercase text-muted-foreground">Include paths/patterns</p>
						<div className="flex flex-col gap-1">
							{formValues.includePatterns?.slice(0, 20).map((path) => (
								<span key={path} className="text-xs font-mono bg-accent px-1.5 py-0.5 rounded">
									{path}
								</span>
							))}
							{formValues.includePatterns && formValues.includePatterns.length > 20 && (
								<span className="text-xs text-muted-foreground">+ {formValues.includePatterns.length - 20} more</span>
							)}
							{formValues.includePatternsText
								?.split("\n")
								.filter(Boolean)
								.slice(0, 20 - (formValues.includePatterns?.length || 0))
								.map((pattern) => (
									<span key={pattern} className="text-xs font-mono bg-accent px-1.5 py-0.5 rounded">
										{pattern.trim()}
									</span>
								))}
						</div>
					</div>
				) : null}
				{formValues.excludePatternsText && (
					<div>
						<p className="text-xs uppercase text-muted-foreground">Exclude patterns</p>
						<div className="flex flex-col gap-1">
							{formValues.excludePatternsText
								.split("\n")
								.filter(Boolean)
								.map((pattern) => (
									<span key={pattern} className="text-xs font-mono bg-accent px-1.5 py-0.5 rounded">
										{pattern.trim()}
									</span>
								))}
						</div>
					</div>
				)}
				{formValues.excludeIfPresentText && (
					<div>
						<p className="text-xs uppercase text-muted-foreground">Exclude if present</p>
						<div className="flex flex-col gap-1">
							{formValues.excludeIfPresentText
								.split("\n")
								.filter(Boolean)
								.map((filename) => (
									<span key={filename} className="text-xs font-mono bg-accent px-1.5 py-0.5 rounded">
										{filename.trim()}
									</span>
								))}
						</div>
					</div>
				)}
				<div>
					<p className="text-xs uppercase text-muted-foreground">One file system</p>
					<p className="font-medium">{formValues.oneFileSystem ? "Enabled" : "Disabled"}</p>
				</div>
				<div>
					<p className="text-xs uppercase text-muted-foreground">Retention</p>
					<p className="font-medium">
						{Object.entries(formValues)
							.filter(([key, value]) => key.startsWith("keep") && Boolean(value))
							.map(([key, value]) => {
								const label = key.replace("keep", "").toLowerCase();
								return `${value.toString()} ${label}`;
							})
							.join(", ") || "-"}
					</p>
				</div>
			</CardContent>
		</Card>
	);
};
