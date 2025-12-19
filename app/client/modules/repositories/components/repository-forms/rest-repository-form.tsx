import type { UseFormReturn } from "react-hook-form";
import {
	FormControl,
	FormDescription,
	FormField,
	FormItem,
	FormLabel,
	FormMessage,
} from "../../../../components/ui/form";
import { Input } from "../../../../components/ui/input";
import { SecretInput } from "../../../../components/ui/secret-input";
import { Textarea } from "../../../../components/ui/textarea";
import { Checkbox } from "../../../../components/ui/checkbox";
import type { RepositoryFormValues } from "../create-repository-form";

type Props = {
	form: UseFormReturn<RepositoryFormValues>;
};

export const RestRepositoryForm = ({ form }: Props) => {
	return (
		<>
			<FormField
				control={form.control}
				name="url"
				render={({ field }) => (
					<FormItem>
						<FormLabel>REST Server URL</FormLabel>
						<FormControl>
							<Input placeholder="http://192.168.1.30:8000" {...field} />
						</FormControl>
						<FormDescription>URL of the REST server.</FormDescription>
						<FormMessage />
					</FormItem>
				)}
			/>
			<FormField
				control={form.control}
				name="path"
				render={({ field }) => (
					<FormItem>
						<FormLabel>Repository Path (Optional)</FormLabel>
						<FormControl>
							<Input placeholder="my-backup-repo" {...field} />
						</FormControl>
						<FormDescription>Path to the repository on the REST server (leave empty for root).</FormDescription>
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
							<Input placeholder="username" {...field} />
						</FormControl>
						<FormDescription>Username for REST server authentication.</FormDescription>
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
							<SecretInput placeholder="••••••••" value={field.value ?? ""} onChange={field.onChange} />
						</FormControl>
						<FormDescription>Password for REST server authentication.</FormDescription>
						<FormMessage />
					</FormItem>
				)}
			/>
			<FormField
				control={form.control}
				name="cacert"
				render={({ field }) => (
					<FormItem>
						<FormLabel>CA Certificate (Optional)</FormLabel>
						<FormControl>
							<Textarea
								placeholder="-----BEGIN CERTIFICATE-----&#10;...&#10;-----END CERTIFICATE-----"
								rows={6}
								{...field}
							/>
						</FormControl>
						<FormDescription>
							Custom CA certificate for self-signed certificates (PEM format). https://restic.readthedocs.io/en/stable/030_preparing_a_new_repo.html#rest-server
						</FormDescription>
						<FormMessage />
					</FormItem>
				)}
			/>
			<FormField
				control={form.control}
				name="insecureTls"
				render={({ field }) => (
					<FormItem className="flex flex-row items-start space-x-3 space-y-0 rounded-md border p-4">
						<FormControl>
							<Checkbox checked={field.value ?? false} onCheckedChange={field.onChange} />
						</FormControl>
						<div className="space-y-1 leading-none">
							<FormLabel>Skip TLS Certificate Verification</FormLabel>
							<FormDescription>
								Disable TLS certificate verification. This is insecure and should only be used for testing. To trust a self-signed certificate without skipping verification, paste the CA certificate in the CA Certificate field.
							</FormDescription>
						</div>
					</FormItem>
				)}
			/>
		</>
	);
};
