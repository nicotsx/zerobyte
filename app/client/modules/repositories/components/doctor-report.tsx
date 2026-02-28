import { AlertCircle, CheckCircle2 } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "~/client/components/ui/collapsible";
import { formatDateTime } from "~/client/lib/datetime";
import { cn, safeJsonParse } from "~/client/lib/utils";
import { Card, CardTitle } from "~/client/components/ui/card";

type DoctorStep = {
	step: string;
	success: boolean;
	output: string | null;
	error: string | null;
};

type DoctorResult = {
	success: boolean;
	steps: DoctorStep[];
	completedAt: number;
};

type Props = {
	result?: DoctorResult | null;
	repositoryStatus: string | null;
};

export const DoctorReport = ({ result, repositoryStatus }: Props) => {
	return (
		<Card className="px-6 py-6 flex flex-col gap-4 h-full">
			<div className="flex items-center justify-between">
				<CardTitle>Doctor Report</CardTitle>
				{result && (
					<span className="text-xs text-muted-foreground bg-muted/50 px-2 py-1 rounded-md">
						{formatDateTime(result.completedAt)}
					</span>
				)}
			</div>

			{result && (
				<div className="space-y-2">
					{result.steps.map((step) => (
						<Collapsible key={step.step} className="border border-border/50 rounded-lg overflow-hidden group">
							<CollapsibleTrigger className="w-full flex items-center justify-between p-3 hover:bg-muted/50 transition-colors">
								<span className="text-sm font-medium capitalize">{step.step.replaceAll("_", " ")}</span>
								{step.success ? (
									<CheckCircle2 className="h-4 w-4 text-emerald-500" />
								) : (
									<AlertCircle className="h-4 w-4 text-red-500" />
								)}
							</CollapsibleTrigger>
							<CollapsibleContent className="border-t border-border/50 bg-muted/30">
								<div className="p-3 space-y-3">
									{step.output && (
										<pre className="text-xs font-mono bg-background p-3 rounded-md border border-border/50 overflow-auto max-h-50 whitespace-pre-wrap">
											{safeJsonParse(step.output) ? JSON.stringify(safeJsonParse(step.output), null, 2) : step.output}
										</pre>
									)}
									{step.error && (
										<div className="space-y-2">
											<div className="text-[10px] uppercase font-bold text-red-500/70 tracking-wider">Error</div>
											<pre className="text-xs font-mono bg-red-500/10 text-red-500 p-3 rounded-md border border-red-500/20 overflow-auto whitespace-pre-wrap">
												{step.error}
											</pre>
										</div>
									)}
									{!step.output && !step.error && (
										<div className="text-sm text-muted-foreground italic">No output recorded</div>
									)}
								</div>
							</CollapsibleContent>
						</Collapsible>
					))}
				</div>
			)}
			<div
				className={cn("bg-muted/30 border border-border/50 rounded-lg p-6 text-center", {
					hidden: result != null || repositoryStatus === "doctor",
				})}
			>
				<p className="text-sm text-muted-foreground">No doctor report available.</p>
			</div>
			<div
				className={cn("border border-border/50 rounded-lg p-6 text-center bg-muted/20", {
					hidden: repositoryStatus !== "doctor",
				})}
			>
				<div className="flex items-center justify-center gap-2">
					<div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
					<p className="text-sm font-medium">Doctor operation running...</p>
				</div>
			</div>
		</Card>
	);
};
