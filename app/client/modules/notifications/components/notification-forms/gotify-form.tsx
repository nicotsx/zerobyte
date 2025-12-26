import type { UseFormReturn } from "react-hook-form";
import { FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "~/client/components/ui/form";
import { Input } from "~/client/components/ui/input";
import { SecretInput } from "~/client/components/ui/secret-input";
import type { NotificationFormValues } from "../create-notification-form";

type Props = {
	form: UseFormReturn<NotificationFormValues>;
};

export const GotifyForm = ({ form }: Props) => {
	return (
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
							<SecretInput {...field} placeholder="••••••••" />
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
	);
};
