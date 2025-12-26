import type { UseFormReturn } from "react-hook-form";
import { FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "~/client/components/ui/form";
import { Input } from "~/client/components/ui/input";
import type { NotificationFormValues } from "../create-notification-form";

type Props = {
	form: UseFormReturn<NotificationFormValues>;
};

export const DiscordForm = ({ form }: Props) => {
	return (
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
	);
};
