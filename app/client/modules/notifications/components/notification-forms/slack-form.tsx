import type { UseFormReturn } from "react-hook-form";
import { FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "~/client/components/ui/form";
import { Input } from "~/client/components/ui/input";
import type { NotificationFormValues } from "../create-notification-form";

type Props = {
	form: UseFormReturn<NotificationFormValues>;
};

export const SlackForm = ({ form }: Props) => {
	return (
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
	);
};
