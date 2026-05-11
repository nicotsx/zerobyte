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

export const B2RepositoryForm = ({ form }: Props) => {
	return (
		<>
			<FormField
				control={form.control}
				name="bucket"
				render={({ field }) => (
					<FormItem>
						<FormLabel>Bucket</FormLabel>
						<FormControl>
							<Input placeholder="my-backup-bucket" {...field} />
						</FormControl>
						<FormDescription>Backblaze bucket name for storing backups.</FormDescription>
						<FormMessage />
					</FormItem>
				)}
			/>
			<FormField
				control={form.control}
				name="path"
				render={({ field }) => (
					<FormItem>
						<FormLabel>Bucket</FormLabel>
						<FormControl>
							<Input placeholder="/path/to" {...field} />
						</FormControl>
						<FormDescription>Path inside the bucket to store data</FormDescription>
						<FormMessage />
					</FormItem>
				)}
			/>
			<FormField
				control={form.control}
				name="accountId"
				render={({ field }) => (
					<FormItem>
						<FormLabel>Access Key ID</FormLabel>
						<FormControl>
							<Input placeholder="AKIAIOSFODNN7EXAMPLE" {...field} />
						</FormControl>
						<FormDescription>S3 access key ID for authentication.</FormDescription>
						<FormMessage />
					</FormItem>
				)}
			/>
			<FormField
				control={form.control}
				name="accountKey"
				render={({ field }) => (
					<FormItem>
						<FormLabel>Secret Access Key</FormLabel>
						<FormControl>
							<SecretInput placeholder="••••••••" value={field.value ?? ""} onChange={field.onChange} />
						</FormControl>
						<FormDescription>S3 secret access key for authentication.</FormDescription>
						<FormMessage />
					</FormItem>
				)}
			/>
		</>
	);
};
