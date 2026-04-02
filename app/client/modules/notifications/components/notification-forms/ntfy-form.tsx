import type { UseFormReturn } from "react-hook-form";
import { FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "~/client/components/ui/form";
import { Input } from "~/client/components/ui/input";
import { SecretInput } from "~/client/components/ui/secret-input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "~/client/components/ui/select";
import type { NotificationFormValues } from "../create-notification-form";

type Props = {
	form: UseFormReturn<NotificationFormValues>;
};

export const NtfyForm = ({ form }: Props) => {
	return (
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
							<Input {...field} placeholder="zerobyte-backups" />
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
							<SecretInput {...field} placeholder="••••••••" />
						</FormControl>
						<FormDescription>Password for server authentication, if required.</FormDescription>
						<FormMessage />
					</FormItem>
				)}
			/>
			<FormField
				control={form.control}
				name="accessToken"
				render={({ field }) => (
					<FormItem>
						<FormLabel>Access token (Optional)</FormLabel>
						<FormControl>
							<SecretInput {...field} placeholder="••••••••" />
						</FormControl>
						<FormDescription>
							Access token for server authentication. Will take precedence over username/password if set.
						</FormDescription>
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
						<Select onValueChange={field.onChange} value={String(field.value)}>
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
	);
};
