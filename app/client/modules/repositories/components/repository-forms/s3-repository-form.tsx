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
import type { RepositoryFormValues } from "../create-repository-form";

type Props = {
	form: UseFormReturn<RepositoryFormValues>;
};

export const S3RepositoryForm = ({ form }: Props) => {
	return (
		<>
			<FormField
				control={form.control}
				name="endpoint"
				render={({ field }) => (
					<FormItem>
						<FormLabel>Endpoint</FormLabel>
						<FormControl>
							<Input placeholder="s3.amazonaws.com" {...field} />
						</FormControl>
						<FormDescription>S3-compatible endpoint URL.</FormDescription>
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
						<FormDescription>S3 bucket name for storing backups.</FormDescription>
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
							<Input placeholder="AKIAIOSFODNN7EXAMPLE" {...field} />
						</FormControl>
						<FormDescription>S3 access key ID for authentication.</FormDescription>
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
							<Input type="password" placeholder="••••••••" {...field} />
						</FormControl>
						<FormDescription>S3 secret access key for authentication.</FormDescription>
						<FormMessage />
					</FormItem>
				)}
			/>
		</>
	);
};
