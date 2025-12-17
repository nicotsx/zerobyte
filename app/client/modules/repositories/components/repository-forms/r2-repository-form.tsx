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
import type { RepositoryFormValues } from "../create-repository-form";

type Props = {
	form: UseFormReturn<RepositoryFormValues>;
};

export const R2RepositoryForm = ({ form }: Props) => {
	return (
		<>
			<FormField
				control={form.control}
				name="endpoint"
				render={({ field }) => (
					<FormItem>
						<FormLabel>Endpoint</FormLabel>
						<FormControl>
							<Input placeholder="<account-id>.r2.cloudflarestorage.com" {...field} />
						</FormControl>
						<FormDescription>
							R2 endpoint (without https://). Find in R2 dashboard under bucket settings.
						</FormDescription>
						<FormMessage />
					</FormItem>
				)}
			/>
			<FormField
				control={form.control}
				name="bucket"
				render={({ field }) => (
					<FormItem>
						<FormLabel>Bucket</FormLabel>
						<FormControl>
							<Input placeholder="my-backup-bucket" {...field} />
						</FormControl>
						<FormDescription>R2 bucket name for storing backups.</FormDescription>
						<FormMessage />
					</FormItem>
				)}
			/>
			<FormField
				control={form.control}
				name="accessKeyId"
				render={({ field }) => (
					<FormItem>
						<FormLabel>Access Key ID</FormLabel>
						<FormControl>
							<Input placeholder="Access Key ID from R2 API tokens" {...field} />
						</FormControl>
						<FormDescription>R2 API token Access Key ID (create in Cloudflare R2 dashboard).</FormDescription>
						<FormMessage />
					</FormItem>
				)}
			/>
			<FormField
				control={form.control}
				name="secretAccessKey"
				render={({ field }) => (
					<FormItem>
						<FormLabel>Secret Access Key</FormLabel>
						<FormControl>
							<SecretInput placeholder="••••••••" value={field.value ?? ""} onChange={field.onChange} />
						</FormControl>
						<FormDescription>R2 API token Secret Access Key (shown once when creating token).</FormDescription>
						<FormMessage />
					</FormItem>
				)}
			/>
		</>
	);
};
