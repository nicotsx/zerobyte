import { arktypeResolver } from "@hookform/resolvers/arktype";
import { type } from "arktype";
import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { cn, slugify } from "~/client/lib/utils";
import { deepClean } from "~/utils/object";
import {
	Form,
	FormControl,
	FormDescription,
	FormField,
	FormItem,
	FormLabel,
	FormMessage,
} from "~/client/components/ui/form";
import { Input } from "~/client/components/ui/input";
import { SecretInput } from "~/client/components/ui/secret-input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "~/client/components/ui/select";
import { Checkbox } from "~/client/components/ui/checkbox";
import { notificationConfigSchema } from "~/schemas/notifications";

export const formSchema = type({
	name: "2<=string<=32",
}).and(notificationConfigSchema);
const cleanSchema = type.pipe((d) => formSchema(deepClean(d)));

export type NotificationFormValues = typeof formSchema.inferIn;

type Props = {
	onSubmit: (values: NotificationFormValues) => void;
	mode?: "create" | "update";
	initialValues?: Partial<NotificationFormValues>;
	formId?: string;
	className?: string;
};

const defaultValuesForType = {
	email: {
		type: "email" as const,
		smtpHost: "",
		smtpPort: 587,
		username: "",
		password: "",
		from: "",
		to: [],
		useTLS: true,
	},
	slack: {
		type: "slack" as const,
		webhookUrl: "",
	},
	discord: {
		type: "discord" as const,
		webhookUrl: "",
	},
	gotify: {
		type: "gotify" as const,
		serverUrl: "",
		token: "",
		priority: 5,
	},
	ntfy: {
		type: "ntfy" as const,
		topic: "",
		priority: "default" as const,
	},
	pushover: {
		type: "pushover" as const,
		userKey: "",
		apiToken: "",
		priority: 0 as const,
	},
	telegram: {
		type: "telegram" as const,
		botToken: "",
		chatId: "",
	},
	custom: {
		type: "custom" as const,
		shoutrrrUrl: "",
	},
};

export const CreateNotificationForm = ({ onSubmit, mode = "create", initialValues, formId, className }: Props) => {
	const form = useForm<NotificationFormValues>({
		resolver: arktypeResolver(cleanSchema as unknown as typeof formSchema),
		defaultValues: initialValues,
		resetOptions: {
			keepDefaultValues: true,
			keepDirtyValues: false,
		},
	});

	const { watch } = form;
	const watchedType = watch("type");

	useEffect(() => {
		if (!initialValues) {
			form.reset({
				name: form.getValues().name,
				...defaultValuesForType[watchedType as keyof typeof defaultValuesForType],
			});
		}
	}, [watchedType, form, initialValues]);

	return (
		<Form {...form}>
			<form id={formId} onSubmit={form.handleSubmit(onSubmit)} className={cn("space-y-4", className)}>
				<FormField
					control={form.control}
					name="name"
					render={({ field }) => (
						<FormItem>
							<FormLabel>Name</FormLabel>
							<FormControl>
								<Input
									{...field}
									placeholder="My notification"
									onChange={(e) => field.onChange(slugify(e.target.value))}
									max={32}
									min={2}
								/>
							</FormControl>
							<FormDescription>Unique identifier for this notification destination.</FormDescription>
							<FormMessage />
						</FormItem>
					)}
				/>

				<FormField
					control={form.control}
					name="type"
					render={({ field }) => (
						<FormItem>
							<FormLabel>Type</FormLabel>
							<Select
								onValueChange={field.onChange}
								defaultValue={field.value}
								value={field.value}
								disabled={mode === "update"}
							>
								<FormControl>
									<SelectTrigger className={mode === "update" ? "bg-gray-50" : ""}>
										<SelectValue placeholder="Select notification type" />
									</SelectTrigger>
								</FormControl>
								<SelectContent>
									<SelectItem value="email">Email (SMTP)</SelectItem>
									<SelectItem value="slack">Slack</SelectItem>
									<SelectItem value="discord">Discord</SelectItem>
									<SelectItem value="gotify">Gotify</SelectItem>
									<SelectItem value="ntfy">Ntfy</SelectItem>
									<SelectItem value="pushover">Pushover</SelectItem>
									<SelectItem value="telegram">Telegram</SelectItem>
									<SelectItem value="custom">Custom (Shoutrrr URL)</SelectItem>
								</SelectContent>
							</Select>
							<FormDescription>Choose the notification delivery method.</FormDescription>
							<FormMessage />
						</FormItem>
					)}
				/>

				{watchedType === "email" && (
					<>
						<FormField
							control={form.control}
							name="smtpHost"
							render={({ field }) => (
								<FormItem>
									<FormLabel>SMTP Host</FormLabel>
									<FormControl>
										<Input {...field} placeholder="smtp.example.com" />
									</FormControl>
									<FormMessage />
								</FormItem>
							)}
						/>
						<FormField
							control={form.control}
							name="smtpPort"
							render={({ field }) => (
								<FormItem>
									<FormLabel>SMTP Port</FormLabel>
									<FormControl>
										<Input
											{...field}
											type="number"
											placeholder="587"
											onChange={(e) => field.onChange(Number(e.target.value))}
										/>
									</FormControl>
									<FormMessage />
								</FormItem>
							)}
						/>
						<FormField
							control={form.control}
							name="username"
							render={({ field }) => (
								<FormItem>
									<FormLabel>Username (Optional)</FormLabel>
									<FormControl>
										<Input {...field} placeholder="user@example.com" />
									</FormControl>
									<FormMessage />
								</FormItem>
							)}
						/>
						<FormField
							control={form.control}
							name="password"
							render={({ field }) => (
								<FormItem>
									<FormLabel>Password (Optional)</FormLabel>
									<FormControl>
										<SecretInput
											{...field}
											isDirty={form.getFieldState("password", form.formState).isDirty}
											placeholder="••••••••"
										/>
									</FormControl>
									<FormMessage />
								</FormItem>
							)}
						/>
						<FormField
							control={form.control}
							name="from"
							render={({ field }) => (
								<FormItem>
									<FormLabel>From Address</FormLabel>
									<FormControl>
										<Input {...field} placeholder="noreply@example.com" />
									</FormControl>
									<FormMessage />
								</FormItem>
							)}
						/>
						<FormField
							control={form.control}
							name="to"
							render={({ field }) => (
								<FormItem>
									<FormLabel>To Addresses</FormLabel>
									<FormControl>
										<Input
											{...field}
											placeholder="user@example.com, admin@example.com"
											value={Array.isArray(field.value) ? field.value.join(", ") : ""}
											onChange={(e) => field.onChange(e.target.value.split(",").map((email) => email.trim()))}
										/>
									</FormControl>
									<FormDescription>Comma-separated list of recipient email addresses.</FormDescription>
									<FormMessage />
								</FormItem>
							)}
						/>
						<FormField
							control={form.control}
							name="useTLS"
							render={({ field }) => (
								<FormItem className="flex flex-row items-center space-x-3">
									<FormControl>
										<Checkbox checked={field.value} onCheckedChange={field.onChange} />
									</FormControl>
									<div className="space-y-1 leading-none">
										<FormLabel>Use TLS</FormLabel>
										<FormDescription>Enable TLS encryption for SMTP connection.</FormDescription>
									</div>
								</FormItem>
							)}
						/>
					</>
				)}

				{watchedType === "slack" && (
					<>
						<FormField
							control={form.control}
							name="webhookUrl"
							render={({ field }) => (
								<FormItem>
									<FormLabel>Webhook URL</FormLabel>
									<FormControl>
										<Input
											{...field}
											placeholder="https://hooks.slack.com/services/T00000000/B00000000/XXXXXXXXXXXXXXXXXXXX"
										/>
									</FormControl>
									<FormDescription>Get this from your Slack app's Incoming Webhooks settings.</FormDescription>
									<FormMessage />
								</FormItem>
							)}
						/>
						<FormField
							control={form.control}
							name="channel"
							render={({ field }) => (
								<FormItem>
									<FormLabel>Channel (Optional)</FormLabel>
									<FormControl>
										<Input {...field} placeholder="#backups" />
									</FormControl>
									<FormDescription>Override the default channel (use # for channels, @ for users).</FormDescription>
									<FormMessage />
								</FormItem>
							)}
						/>
						<FormField
							control={form.control}
							name="username"
							render={({ field }) => (
								<FormItem>
									<FormLabel>Bot Username (Optional)</FormLabel>
									<FormControl>
										<Input {...field} placeholder="Zerobyte" />
									</FormControl>
									<FormMessage />
								</FormItem>
							)}
						/>
						<FormField
							control={form.control}
							name="iconEmoji"
							render={({ field }) => (
								<FormItem>
									<FormLabel>Icon Emoji (Optional)</FormLabel>
									<FormControl>
										<Input {...field} placeholder=":floppy_disk:" />
									</FormControl>
									<FormMessage />
								</FormItem>
							)}
						/>
					</>
				)}

				{watchedType === "discord" && (
					<>
						<FormField
							control={form.control}
							name="webhookUrl"
							render={({ field }) => (
								<FormItem>
									<FormLabel>Webhook URL</FormLabel>
									<FormControl>
										<Input {...field} placeholder="https://discord.com/api/webhooks/WEBHOOK_ID/WEBHOOK_TOKEN" />
									</FormControl>
									<FormDescription>Get this from your Discord server's Integrations settings.</FormDescription>
									<FormMessage />
								</FormItem>
							)}
						/>
						<FormField
							control={form.control}
							name="username"
							render={({ field }) => (
								<FormItem>
									<FormLabel>Bot Username (Optional)</FormLabel>
									<FormControl>
										<Input {...field} placeholder="Zerobyte" />
									</FormControl>
									<FormMessage />
								</FormItem>
							)}
						/>
						<FormField
							control={form.control}
							name="avatarUrl"
							render={({ field }) => (
								<FormItem>
									<FormLabel>Avatar URL (Optional)</FormLabel>
									<FormControl>
										<Input {...field} placeholder="https://example.com/avatar.png" />
									</FormControl>
									<FormMessage />
								</FormItem>
							)}
						/>
						<FormField
							control={form.control}
							name="threadId"
							render={({ field }) => (
								<FormItem>
									<FormLabel>Thread ID (Optional)</FormLabel>
									<FormControl>
										<Input {...field} />
									</FormControl>
									<FormDescription>
										ID of the thread to post messages in. Leave empty to post in the main channel.
									</FormDescription>
									<FormMessage />
								</FormItem>
							)}
						/>
					</>
				)}

				{watchedType === "gotify" && (
					<>
						<FormField
							control={form.control}
							name="serverUrl"
							render={({ field }) => (
								<FormItem>
									<FormLabel>Server URL</FormLabel>
									<FormControl>
										<Input {...field} placeholder="https://gotify.example.com" />
									</FormControl>
									<FormDescription>Your self-hosted Gotify server URL.</FormDescription>
									<FormMessage />
								</FormItem>
							)}
						/>
						<FormField
							control={form.control}
							name="token"
							render={({ field }) => (
								<FormItem>
									<FormLabel>App Token</FormLabel>
									<FormControl>
										<SecretInput
											{...field}
											isDirty={form.getFieldState("token", form.formState).isDirty}
											placeholder="••••••••"
										/>
									</FormControl>
									<FormDescription>Application token from Gotify.</FormDescription>
									<FormMessage />
								</FormItem>
							)}
						/>
						<FormField
							control={form.control}
							name="priority"
							render={({ field }) => (
								<FormItem>
									<FormLabel>Priority</FormLabel>
									<FormControl>
										<Input
											{...field}
											type="number"
											min={0}
											max={10}
											onChange={(e) => field.onChange(Number(e.target.value))}
										/>
									</FormControl>
									<FormDescription>Priority level (0-10, where 10 is highest).</FormDescription>
									<FormMessage />
								</FormItem>
							)}
						/>
						<FormField
							control={form.control}
							name="path"
							render={({ field }) => (
								<FormItem>
									<FormLabel>Path (Optional)</FormLabel>
									<FormControl>
										<Input {...field} placeholder="/custom/path" />
									</FormControl>
									<FormDescription>Custom path on the Gotify server, if applicable.</FormDescription>
									<FormMessage />
								</FormItem>
							)}
						/>
					</>
				)}

				{watchedType === "ntfy" && (
					<>
						<FormField
							control={form.control}
							name="serverUrl"
							render={({ field }) => (
								<FormItem>
									<FormLabel>Server URL (Optional)</FormLabel>
									<FormControl>
										<Input {...field} placeholder="https://ntfy.example.com" />
									</FormControl>
									<FormDescription>Leave empty to use ntfy.sh public service.</FormDescription>
									<FormMessage />
								</FormItem>
							)}
						/>
						<FormField
							control={form.control}
							name="topic"
							render={({ field }) => (
								<FormItem>
									<FormLabel>Topic</FormLabel>
									<FormControl>
										<Input {...field} placeholder="ironmount-backups" />
									</FormControl>
									<FormDescription>The ntfy topic name to publish to.</FormDescription>
									<FormMessage />
								</FormItem>
							)}
						/>
						<FormField
							control={form.control}
							name="username"
							render={({ field }) => (
								<FormItem>
									<FormLabel>Username (Optional)</FormLabel>
									<FormControl>
										<Input {...field} placeholder="username" />
									</FormControl>
									<FormDescription>Username for server authentication, if required.</FormDescription>
									<FormMessage />
								</FormItem>
							)}
						/>
						<FormField
							control={form.control}
							name="password"
							render={({ field }) => (
								<FormItem>
									<FormLabel>Password (Optional)</FormLabel>
									<FormControl>
										<SecretInput
											{...field}
											isDirty={form.getFieldState("password", form.formState).isDirty}
											placeholder="••••••••"
										/>
									</FormControl>
									<FormDescription>Password for server authentication, if required.</FormDescription>
									<FormMessage />
								</FormItem>
							)}
						/>
						<FormField
							control={form.control}
							name="priority"
							render={({ field }) => (
								<FormItem>
									<FormLabel>Priority</FormLabel>
									<Select onValueChange={field.onChange} defaultValue={String(field.value)} value={String(field.value)}>
										<FormControl>
											<SelectTrigger>
												<SelectValue placeholder="Select priority" />
											</SelectTrigger>
										</FormControl>
										<SelectContent>
											<SelectItem value="max">Max (5)</SelectItem>
											<SelectItem value="high">High (4)</SelectItem>
											<SelectItem value="default">Default (3)</SelectItem>
											<SelectItem value="low">Low (2)</SelectItem>
											<SelectItem value="min">Min (1)</SelectItem>
										</SelectContent>
									</Select>
									<FormMessage />
								</FormItem>
							)}
						/>
					</>
				)}

				{watchedType === "pushover" && (
					<>
						<FormField
							control={form.control}
							name="userKey"
							render={({ field }) => (
								<FormItem>
									<FormLabel>User Key</FormLabel>
									<FormControl>
										<Input {...field} placeholder="uQiRzpo4DXghDmr9QzzfQu27cmVRsG" />
									</FormControl>
									<FormDescription>Your Pushover user key from the dashboard.</FormDescription>
									<FormMessage />
								</FormItem>
							)}
						/>
						<FormField
							control={form.control}
							name="apiToken"
							render={({ field }) => (
								<FormItem>
									<FormLabel>API Token</FormLabel>
									<FormControl>
										<SecretInput
											{...field}
											isDirty={form.getFieldState("apiToken", form.formState).isDirty}
											placeholder="••••••••"
										/>
									</FormControl>
									<FormDescription>Application API token from your Pushover application.</FormDescription>
									<FormMessage />
								</FormItem>
							)}
						/>
						<FormField
							control={form.control}
							name="devices"
							render={({ field }) => (
								<FormItem>
									<FormLabel>Devices (Optional)</FormLabel>
									<FormControl>
										<Input {...field} placeholder="iphone,android" />
									</FormControl>
									<FormDescription>Comma-separated list of device names. Leave empty for all devices.</FormDescription>
									<FormMessage />
								</FormItem>
							)}
						/>
						<FormField
							control={form.control}
							name="priority"
							render={({ field }) => (
								<FormItem>
									<FormLabel>Priority</FormLabel>
									<Select
										onValueChange={(value) => field.onChange(Number(value))}
										defaultValue={String(field.value)}
										value={String(field.value)}
									>
										<FormControl>
											<SelectTrigger>
												<SelectValue placeholder="Select priority" />
											</SelectTrigger>
										</FormControl>
										<SelectContent>
											<SelectItem value="-1">Low (-1)</SelectItem>
											<SelectItem value="0">Normal (0)</SelectItem>
											<SelectItem value="1">High (1)</SelectItem>
										</SelectContent>
									</Select>
									<FormDescription>Message priority level.</FormDescription>
									<FormMessage />
								</FormItem>
							)}
						/>
					</>
				)}

				{watchedType === "telegram" && (
					<>
						<FormField
							control={form.control}
							name="botToken"
							render={({ field }) => (
								<FormItem>
									<FormLabel>Bot Token</FormLabel>
									<FormControl>
										<SecretInput
											{...field}
											isDirty={form.getFieldState("botToken", form.formState).isDirty}
											placeholder="123456789:ABC-DEF1234ghIkl-zyx57W2v1u123ew11"
										/>
									</FormControl>
									<FormDescription>
										Telegram bot token. Get this from BotFather when you create your bot.
									</FormDescription>
									<FormMessage />
								</FormItem>
							)}
						/>
						<FormField
							control={form.control}
							name="chatId"
							render={({ field }) => (
								<FormItem>
									<FormLabel>Chat ID</FormLabel>
									<FormControl>
										<Input {...field} placeholder="-1231234567890" />
									</FormControl>
									<FormDescription>Telegram chat ID to send notifications to.</FormDescription>
									<FormMessage />
								</FormItem>
							)}
						/>
					</>
				)}

				{watchedType === "custom" && (
					<FormField
						control={form.control}
						name="shoutrrrUrl"
						render={({ field }) => (
							<FormItem>
								<FormLabel>Shoutrrr URL</FormLabel>
								<FormControl>
									<Input
										{...field}
										placeholder="smtp://user:pass@smtp.gmail.com:587/?from=you@gmail.com&to=recipient@example.com"
									/>
								</FormControl>
								<FormDescription>
									Direct Shoutrrr URL for power users. See&nbsp;
									<a
										href="https://shoutrrr.nickfedor.com/v0.12.0/services/overview/"
										target="_blank"
										rel="noopener noreferrer"
										className="text-strong-accent hover:underline"
									>
										Shoutrrr documentation
									</a>
									&nbsp;for supported services and URL formats.
								</FormDescription>
								<FormMessage />
							</FormItem>
						)}
					/>
				)}
			</form>
		</Form>
	);
};
