import { FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "~/client/components/ui/form";
import { Textarea } from "~/client/components/ui/textarea";
import { type UseFormReturn } from "react-hook-form";
import type { InternalFormValues } from "./types";
import { Input } from "~/client/components/ui/input";
import { Checkbox } from "~/client/components/ui/checkbox";

type AdvancedSectionProps = {
	form: UseFormReturn<InternalFormValues>;
};

type WebhookPhase = {
	name: "preBackupWebhook" | "postBackupWebhook";
	label: string;
	urlPlaceholder: string;
	bodyPlaceholder: string;
	description: string;
};

type WebhookFieldsProps = {
	form: UseFormReturn<InternalFormValues>;
	phase: WebhookPhase;
};

const WEBHOOK_PHASES: WebhookPhase[] = [
	{
		name: "preBackupWebhook",
		label: "Pre-backup",
		urlPlaceholder: "http://host.docker.internal:8080/stop",
		bodyPlaceholder: '{"action":"stop"}',
		description: "Called with POST before restic starts. A non-2xx response stops the backup.",
	},
	{
		name: "postBackupWebhook",
		label: "Post-backup",
		urlPlaceholder: "http://host.docker.internal:8080/start",
		bodyPlaceholder: '{"action":"start"}',
		description: "Called with POST after restic finishes, including failed or cancelled runs.",
	},
];

const WebhookFields = ({ form, phase }: WebhookFieldsProps) => {
	return (
		<>
			<FormField
				control={form.control}
				name={`${phase.name}.url`}
				render={({ field }) => (
					<FormItem>
						<FormLabel>{phase.label} webhook</FormLabel>
						<FormControl>
							<Input {...field} type="url" placeholder={phase.urlPlaceholder} />
						</FormControl>
						<FormDescription>
							{phase.description} The URL origin must be listed in WEBHOOK_ALLOWED_ORIGINS; redirects are
							not followed.
						</FormDescription>
						<FormMessage />
					</FormItem>
				)}
			/>
			<FormField
				control={form.control}
				name={`${phase.name}.insecureTls`}
				render={({ field }) => (
					<FormItem className="flex flex-row items-start space-x-3 space-y-0 rounded-md border p-4">
						<FormControl>
							<Checkbox checked={field.value ?? false} onCheckedChange={field.onChange} />
						</FormControl>
						<div className="space-y-1 leading-none">
							<FormLabel>Skip TLS certificate verification</FormLabel>
							<FormDescription>
								Allow this {phase.label.toLowerCase()} webhook to use self-signed certificates. This is
								insecure and should only be enabled for trusted endpoints.
							</FormDescription>
						</div>
					</FormItem>
				)}
			/>
			<FormField
				control={form.control}
				name={`${phase.name}.headersText`}
				render={({ field }) => (
					<FormItem>
						<FormLabel>{phase.label} webhook headers</FormLabel>
						<FormControl>
							<Textarea
								{...field}
								placeholder="Authorization: Bearer token&#10;X-Custom-Header: value"
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
				name={`${phase.name}.body`}
				render={({ field }) => (
					<FormItem>
						<FormLabel>{phase.label} webhook body</FormLabel>
						<FormControl>
							<Textarea
								{...field}
								placeholder={phase.bodyPlaceholder}
								className="font-mono text-sm min-h-24"
							/>
						</FormControl>
						<FormDescription>
							Optional raw POST body. Leave empty to send the backup context JSON.
						</FormDescription>
						<FormMessage />
					</FormItem>
				)}
			/>
		</>
	);
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
								onChange={(e) => field.onChange(e.target.value)}
							/>
						</FormControl>
						<FormDescription>
							Maximum number of retry attempts if a backup fails (default: 2).
						</FormDescription>
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
								onChange={(e) => field.onChange(e.target.value)}
							/>
						</FormControl>
						<FormDescription>
							Delay in minutes before retrying a failed backup (default: 15 minutes).
						</FormDescription>
						<FormMessage />
					</FormItem>
				)}
			/>
			{WEBHOOK_PHASES.map((phase) => (
				<WebhookFields key={phase.name} form={form} phase={phase} />
			))}
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
							<code className="bg-muted px-1 rounded">--exclude-larger-than 500M</code>). Only the
							supported flag list is accepted.
						</FormDescription>
						<FormMessage />
					</FormItem>
				)}
			/>
		</>
	);
};
