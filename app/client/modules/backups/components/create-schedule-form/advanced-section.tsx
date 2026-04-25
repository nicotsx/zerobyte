import { FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "~/client/components/ui/form";
import { Textarea } from "~/client/components/ui/textarea";
import { type UseFormReturn } from "react-hook-form";
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
								placeholder="e.g., 2"
								onChange={(e) => field.onChange(e.target.value ? Number(e.target.value) : undefined)}
							/>
						</FormControl>
						<FormDescription>Maximum number of retry attempts if a backup fails (default: 2).</FormDescription>
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
								min={1}
								max={1440}
								step={1}
								placeholder="e.g., 15"
								value={field.value ?? ""}
								onChange={(e) => field.onChange(e.target.value ? Number(e.target.value) : undefined)}
							/>
						</FormControl>
						<FormDescription>Delay in minutes before retrying a failed backup (default: 15 minutes).</FormDescription>
						<FormMessage />
					</FormItem>
				)}
			/>
			<FormField
				control={form.control}
				name="preBackupWebhookUrl"
				render={({ field }) => (
					<FormItem>
						<FormLabel>Pre-backup webhook</FormLabel>
						<FormControl>
							<Input {...field} type="url" placeholder="http://host.docker.internal:8080/stop" />
						</FormControl>
						<FormDescription>
							Called with POST before restic starts. A non-2xx response stops the backup.
						</FormDescription>
						<FormMessage />
					</FormItem>
				)}
			/>
			<FormField
				control={form.control}
				name="preBackupWebhookHeaders"
				render={({ field }) => (
					<FormItem>
						<FormLabel>Pre-backup webhook headers</FormLabel>
						<FormControl>
							<Textarea
								{...field}
								placeholder="Authorization: Bearer token&#10;X-Custom-Header: value"
								value={Array.isArray(field.value) ? field.value.join("\n") : ""}
								onChange={(e) => field.onChange(e.target.value.split("\n"))}
								className="font-mono text-sm min-h-24"
							/>
						</FormControl>
						<FormDescription>
							One header per line in Key: Value format. Values are stored as plain text.
						</FormDescription>
						<FormMessage />
					</FormItem>
				)}
			/>
			<FormField
				control={form.control}
				name="preBackupWebhookBody"
				render={({ field }) => (
					<FormItem>
						<FormLabel>Pre-backup webhook body</FormLabel>
						<FormControl>
							<Textarea {...field} placeholder='{"action":"stop"}' className="font-mono text-sm min-h-24" />
						</FormControl>
						<FormDescription>Optional raw POST body. Leave empty to send the backup context JSON.</FormDescription>
						<FormMessage />
					</FormItem>
				)}
			/>
			<FormField
				control={form.control}
				name="postBackupWebhookUrl"
				render={({ field }) => (
					<FormItem>
						<FormLabel>Post-backup webhook</FormLabel>
						<FormControl>
							<Input {...field} type="url" placeholder="http://host.docker.internal:8080/start" />
						</FormControl>
						<FormDescription>
							Called with POST after restic finishes, including failed or cancelled runs.
						</FormDescription>
						<FormMessage />
					</FormItem>
				)}
			/>
			<FormField
				control={form.control}
				name="postBackupWebhookHeaders"
				render={({ field }) => (
					<FormItem>
						<FormLabel>Post-backup webhook headers</FormLabel>
						<FormControl>
							<Textarea
								{...field}
								placeholder="Authorization: Bearer token&#10;X-Custom-Header: value"
								value={Array.isArray(field.value) ? field.value.join("\n") : ""}
								onChange={(e) => field.onChange(e.target.value.split("\n"))}
								className="font-mono text-sm min-h-24"
							/>
						</FormControl>
						<FormDescription>
							One header per line in Key: Value format. Values are stored as plain text.
						</FormDescription>
						<FormMessage />
					</FormItem>
				)}
			/>
			<FormField
				control={form.control}
				name="postBackupWebhookBody"
				render={({ field }) => (
					<FormItem>
						<FormLabel>Post-backup webhook body</FormLabel>
						<FormControl>
							<Textarea {...field} placeholder='{"action":"start"}' className="font-mono text-sm min-h-24" />
						</FormControl>
						<FormDescription>Optional raw POST body. Leave empty to send the backup context JSON.</FormDescription>
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
