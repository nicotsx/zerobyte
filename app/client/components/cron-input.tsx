import { CronExpressionParser } from "cron-parser";
import { AlertCircle, CheckCircle2 } from "lucide-react";
import { useMemo } from "react";
import { FormControl, FormDescription, FormItem, FormLabel, FormMessage } from "~/client/components/ui/form";
import { Input } from "~/client/components/ui/input";
import { formatDateTime } from "~/client/lib/datetime";
import { cn } from "~/client/lib/utils";

interface CronInputProps {
	value: string;
	onChange: (value: string) => void;
	error?: string;
}

export function CronInput({ value, onChange, error }: CronInputProps) {
	const { isValid, nextRuns, parseError } = useMemo(() => {
		if (!value) {
			return { isValid: false, nextRuns: [], parseError: null };
		}

		const parts = value.trim().split(/\s+/);

		if (parts.length !== 5) {
			return {
				isValid: false,
				nextRuns: [],
				parseError: "Expression must have exactly 5 fields (minute, hour, day, month, day-of-week)",
			};
		}

		try {
			const interval = CronExpressionParser.parse(value);
			const runs: Date[] = [];

			for (let i = 0; i < 5; i++) {
				runs.push(interval.next().toDate());
			}

			return { isValid: true, nextRuns: runs, parseError: null };
		} catch (e) {
			return { isValid: false, nextRuns: [], parseError: (e as Error).message };
		}
	}, [value]);

	return (
		<FormItem className="md:col-span-2">
			<FormLabel>Cron expression</FormLabel>
			<FormControl>
				<div className="relative">
					<Input
						placeholder="* * * * *"
						value={value}
						onChange={(e) => onChange(e.target.value)}
						className={cn("font-mono", {
							"border-destructive": error || (value && !isValid),
						})}
					/>
					<div className="absolute right-3 top-1/2 -translate-y-1/2">
						{value && (
							<div>
								{isValid ? (
									<CheckCircle2 className="h-4 w-4 text-green-500" />
								) : (
									<AlertCircle className="h-4 w-4 text-destructive" />
								)}
							</div>
						)}
					</div>
				</div>
			</FormControl>
			<FormDescription>
				Standard cron format: <code className="bg-muted px-1 rounded">minute hour day month day-of-week</code>.
			</FormDescription>
			{value && !isValid && parseError && <p className="text-xs text-destructive mt-1">{parseError}</p>}
			{isValid && nextRuns.length > 0 && (
				<div className="mt-2 p-3 rounded-md bg-muted/50 border border-border">
					<p className="text-xs font-medium mb-2 text-muted-foreground uppercase tracking-wider">Next 5 executions:</p>
					<ul className="space-y-1">
						{nextRuns.map((date, i) => (
							<li key={date.toISOString()} className="text-xs font-mono flex items-center gap-2">
								<span className="text-muted-foreground w-4">{i + 1}.</span>
								{formatDateTime(date)}
							</li>
						))}
					</ul>
				</div>
			)}
			<FormMessage />
		</FormItem>
	);
}
