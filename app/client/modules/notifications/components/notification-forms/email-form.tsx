import type { UseFormReturn } from "react-hook-form";
import { FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "~/client/components/ui/form";
import { Input } from "~/client/components/ui/input";
import { SecretInput } from "~/client/components/ui/secret-input";
import { Checkbox } from "~/client/components/ui/checkbox";
import type { NotificationFormValues } from "../create-notification-form";

type Props = {
	form: UseFormReturn<NotificationFormValues>;
};

export const EmailForm = ({ form }: Props) => {
	return (
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
							<SecretInput {...field} placeholder="••••••••" />
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
				name="fromName"
				render={({ field }) => (
					<FormItem>
						<FormLabel>From Name (Optional)</FormLabel>
						<FormControl>
							<Input {...field} placeholder="Zerobyte Backup" />
						</FormControl>
						<FormDescription>The display name shown in the email client.</FormDescription>
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
								onChange={(e) =>
									field.onChange(
										e.target.value
											.split(",")
											.map((email) => email.trim())
											.filter(Boolean),
									)
								}
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
	);
};
