import type { UseFormReturn } from "react-hook-form";
import { FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "~/client/components/ui/form";
import { Input } from "~/client/components/ui/input";
import { SecretInput } from "~/client/components/ui/secret-input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "~/client/components/ui/select";
import type { NotificationFormValues } from "../create-notification-form";

type Props = {
	form: UseFormReturn<NotificationFormValues>;
};

export const PushoverForm = ({ form }: Props) => {
	return (
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
							<SecretInput {...field} placeholder="••••••••" />
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
								<SelectItem value="-2">Lowest (-2)</SelectItem>
								<SelectItem value="-1">Low (-1)</SelectItem>
								<SelectItem value="0">Normal (0)</SelectItem>
								<SelectItem value="1">High (1)</SelectItem>
								<SelectItem value="2">Emergency (2)</SelectItem>
							</SelectContent>
						</Select>
						<FormDescription>Message priority level.</FormDescription>
						<FormMessage />
					</FormItem>
				)}
			/>
		</>
	);
};
