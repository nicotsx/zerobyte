import type { UseFormReturn } from "react-hook-form";
import { FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "~/client/components/ui/form";
import { Input } from "~/client/components/ui/input";
import { SecretInput } from "~/client/components/ui/secret-input";
import type { NotificationFormValues } from "../create-notification-form";

type Props = {
	form: UseFormReturn<NotificationFormValues>;
};

export const TelegramForm = ({ form }: Props) => {
	return (
		<>
			<FormField
				control={form.control}
				name="botToken"
				render={({ field }) => (
					<FormItem>
						<FormLabel>Bot Token</FormLabel>
						<FormControl>
							<SecretInput {...field} placeholder="123456789:ABC-DEF1234ghIkl-zyx57W2v1u123ew11" />
						</FormControl>
						<FormDescription>Telegram bot token. Get this from BotFather when you create your bot.</FormDescription>
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
	);
};
