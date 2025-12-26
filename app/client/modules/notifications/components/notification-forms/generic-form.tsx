import type { UseFormReturn } from "react-hook-form";
import { FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "~/client/components/ui/form";
import { Input } from "~/client/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "~/client/components/ui/select";
import { Checkbox } from "~/client/components/ui/checkbox";
import { Textarea } from "~/client/components/ui/textarea";
import { CodeBlock } from "~/client/components/ui/code-block";
import { Label } from "~/client/components/ui/label";
import type { NotificationFormValues } from "../create-notification-form";

type Props = {
	form: UseFormReturn<NotificationFormValues>;
};

const WebhookPreview = ({ values }: { values: Partial<NotificationFormValues> }) => {
	if (values.type !== "generic") return null;

	const contentType = values.contentType || "application/json";
	const headers = values.headers || [];
	const useJson = values.useJson;
	const titleKey = values.titleKey || "title";
	const messageKey = values.messageKey || "message";

	let body = "";
	if (useJson) {
		body = JSON.stringify(
			{
				[titleKey]: "Notification title",
				[messageKey]: "Notification message",
			},
			null,
			2,
		);
	} else {
		body = "Notification message";
	}

	const previewCode = `${values.method} ${values.url}\nContent-Type: ${contentType}${headers.length > 0 ? `\n${headers.join("\n")}` : ""}

${body}`;

	return (
		<div className="space-y-2 pt-4 border-t">
			<Label>Request Preview</Label>
			<CodeBlock code={previewCode} filename="HTTP Request" />
			<p className="text-[0.8rem] text-muted-foreground">This is a preview of the HTTP request that will be sent.</p>
		</div>
	);
};

export const GenericForm = ({ form }: Props) => {
	const watchedValues = form.watch();

	return (
		<>
			<FormField
				control={form.control}
				name="url"
				render={({ field }) => (
					<FormItem>
						<FormLabel>Webhook URL</FormLabel>
						<FormControl>
							<Input {...field} placeholder="https://api.example.com/webhook" />
						</FormControl>
						<FormDescription>The target URL for the webhook.</FormDescription>
						<FormMessage />
					</FormItem>
				)}
			/>
			<FormField
				control={form.control}
				name="method"
				render={({ field }) => (
					<FormItem>
						<FormLabel>Method</FormLabel>
						<Select onValueChange={field.onChange} value={field.value}>
							<FormControl>
								<SelectTrigger>
									<SelectValue placeholder="Select method" />
								</SelectTrigger>
							</FormControl>
							<SelectContent>
								<SelectItem value="GET">GET</SelectItem>
								<SelectItem value="POST">POST</SelectItem>
							</SelectContent>
						</Select>
						<FormMessage />
					</FormItem>
				)}
			/>
			<FormField
				control={form.control}
				name="contentType"
				render={({ field }) => (
					<FormItem>
						<FormLabel>Content Type</FormLabel>
						<FormControl>
							<Input {...field} placeholder="application/json" />
						</FormControl>
						<FormMessage />
					</FormItem>
				)}
			/>
			<FormField
				control={form.control}
				name="headers"
				render={({ field }) => (
					<FormItem>
						<FormLabel>Headers</FormLabel>
						<FormControl>
							<Textarea
								{...field}
								placeholder="Authorization: Bearer token&#10;X-Custom-Header: value"
								value={Array.isArray(field.value) ? field.value.join("\n") : ""}
								onChange={(e) => field.onChange(e.target.value.split("\n"))}
							/>
						</FormControl>
						<FormDescription>One header per line in Key: Value format.</FormDescription>
						<FormMessage />
					</FormItem>
				)}
			/>
			<FormField
				control={form.control}
				name="useJson"
				render={({ field }) => (
					<FormItem className="flex flex-row items-center space-x-3">
						<FormControl>
							<Checkbox checked={field.value} onCheckedChange={field.onChange} />
						</FormControl>
						<div className="space-y-1 leading-none">
							<FormLabel>Use JSON Template</FormLabel>
							<FormDescription>Send the message as a JSON object.</FormDescription>
						</div>
					</FormItem>
				)}
			/>
			{form.watch("useJson") && (
				<>
					<FormField
						control={form.control}
						name="titleKey"
						render={({ field }) => (
							<FormItem>
								<FormLabel>Title Key</FormLabel>
								<FormControl>
									<Input {...field} placeholder="title" />
								</FormControl>
								<FormDescription>The JSON key for the notification title.</FormDescription>
								<FormMessage />
							</FormItem>
						)}
					/>
					<FormField
						control={form.control}
						name="messageKey"
						render={({ field }) => (
							<FormItem>
								<FormLabel>Message Key</FormLabel>
								<FormControl>
									<Input {...field} placeholder="message" />
								</FormControl>
								<FormDescription>The JSON key for the notification message.</FormDescription>
								<FormMessage />
							</FormItem>
						)}
					/>
				</>
			)}
			<WebhookPreview values={watchedValues} />
		</>
	);
};
