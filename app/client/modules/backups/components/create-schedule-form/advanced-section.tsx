import { FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "~/client/components/ui/form";
import { Textarea } from "~/client/components/ui/textarea";
import type { UseFormReturn } from "react-hook-form";
import type { InternalFormValues } from "./types";
import { Input } from "~/client/components/ui/input";

type AdvancedSectionProps = {
	form: UseFormReturn<InternalFormValues>;
};

export const AdvancedSection = ({ form }: AdvancedSectionProps) => {
	return (
		<>
			<FormField
				control={form.control}
				name="maxRetries"
				render={({ field }) => (
					<FormItem>
						<FormLabel>Maximum retries</FormLabel>
						<FormControl>
							<Input
								{...field}
								type="number"
								min={0}
								max={32}
								value={field.value ?? ""}
								onChange={(e) => field.onChange(e.target.value ? Number(e.target.value) : undefined)}
							/>
						</FormControl>
						<FormDescription>Maximum number of retry attempts if a backup fails (default: 0).</FormDescription>
						<FormMessage />
					</FormItem>
				)}
			/>
			<FormField
				control={form.control}
				name="retryDelay"
				render={({ field }) => (
					<FormItem>
						<FormLabel>Retry delay</FormLabel>
						<FormControl>
							<Input
								{...field}
								type="number"
								min={0}
								max={1440}
								step={1}
								value={field.value ?? ""}
								onChange={(e) => field.onChange(e.target.value ? Number(e.target.value) : undefined)}
							/>
						</FormControl>
						<FormDescription>Delay in minutes before retrying a failed backup (default: 60 minutes).</FormDescription>
						<FormMessage />
					</FormItem>
				)}
			/>
			<FormField
				control={form.control}
				name="customResticParamsText"
				render={({ field }) => (
					<FormItem>
						<FormLabel>Custom restic parameters</FormLabel>
						<FormControl>
							<Textarea
								{...field}
								placeholder="--exclude-larger-than 500M&#10;--no-scan&#10;--read-concurrency 8"
								className="font-mono text-sm min-h-24"
							/>
						</FormControl>
						<FormDescription>
							Advanced: enter one restic flag per line (e.g.{" "}
							<code className="bg-muted px-1 rounded">--exclude-larger-than 500M</code>). Only the supported flag list
							is accepted.
						</FormDescription>
						<FormMessage />
					</FormItem>
				)}
			/>
		</>
	);
};
