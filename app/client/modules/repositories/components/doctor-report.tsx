import { AlertCircle, CheckCircle2 } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "~/client/components/ui/collapsible";
import { formatDateTime } from "~/client/lib/datetime";
import { cn, safeJsonParse } from "~/client/lib/utils";

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
		<div>
			<h3 className="text-lg font-semibold">Doctor Report</h3>
			{result && (
				<div className="space-y-2">
					<span className="text-xs text-muted-foreground">Completed {formatDateTime(result.completedAt)}</span>
					<div className="space-y-2 mt-2">
						{result.steps.map((step) => (
							<Collapsible key={step.step} className="border rounded overflow-hidden bg-muted/30 group">
								<CollapsibleTrigger className="w-full flex items-center justify-start p-3 hover:bg-muted/50 transition-colors">
									<div className="flex items-center gap-3">
										<span className="text-sm font-medium">{step.step.replaceAll("_", " ")}</span>
										{step.success ? (
											<CheckCircle2 className="h-4 w-4 text-green-500" />
										) : (
											<AlertCircle className="h-4 w-4 text-red-500" />
										)}
									</div>
								</CollapsibleTrigger>
								<CollapsibleContent className="border-t bg-muted/50">
									<div className="p-2 space-y-3">
										{step.output && (
											<pre className="text-xs font-mono bg-background/50 p-3 border overflow-auto max-h-50 whitespace-pre-wrap">
												{safeJsonParse(step.output) ? JSON.stringify(safeJsonParse(step.output), null, 2) : step.output}
											</pre>
										)}
										{step.error && (
											<div className="space-y-1.5">
												<div className="text-[10px] uppercase font-bold text-red-500/70 px-1">Error</div>
												<pre className="text-xs font-mono bg-red-500/5 text-red-500 p-3 border border-red-500/20 overflow-auto whitespace-pre-wrap">
													{step.error}
												</pre>
											</div>
										)}
										{!step.output && !step.error && (
											<div className="text-xs text-muted-foreground italic px-1">No output recorded</div>
										)}
									</div>
								</CollapsibleContent>
							</Collapsible>
						))}
					</div>
				</div>
			)}
			<div
				className={cn("mt-2 bg-muted/30 border p-6 text-center", {
					hidden: result != null || repositoryStatus === "doctor",
				})}
			>
				<p className="text-sm text-muted-foreground">No doctor report available.</p>
			</div>
			<div
				className={cn("mt-2 border p-6 text-center", {
					hidden: repositoryStatus !== "doctor",
				})}
			>
				<div className="flex items-center justify-center gap-2">
					<div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
					<p className="text-sm ">Doctor operation running...</p>
				</div>
			</div>
		</div>
	);
};
