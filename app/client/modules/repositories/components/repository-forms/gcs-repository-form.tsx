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
import { Textarea } from "../../../../components/ui/textarea";
import type { RepositoryFormValues } from "../create-repository-form";

type Props = {
	form: UseFormReturn<RepositoryFormValues>;
};

export const GCSRepositoryForm = ({ form }: Props) => {
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
						<FormDescription>GCS bucket name for storing backups.</FormDescription>
						<FormMessage />
					</FormItem>
				)}
			/>
			<FormField
				control={form.control}
				name="projectId"
				render={({ field }) => (
					<FormItem>
						<FormLabel>Project ID</FormLabel>
						<FormControl>
							<Input placeholder="my-gcp-project-123" {...field} />
						</FormControl>
						<FormDescription>Google Cloud project ID.</FormDescription>
						<FormMessage />
					</FormItem>
				)}
			/>
			<FormField
				control={form.control}
				name="credentialsJson"
				render={({ field }) => (
					<FormItem>
						<FormLabel>Service Account JSON</FormLabel>
						<FormControl>
							<Textarea placeholder="Paste service account JSON key..." {...field} />
						</FormControl>
						<FormDescription>Service account JSON credentials for authentication.</FormDescription>
						<FormMessage />
					</FormItem>
				)}
			/>
		</>
	);
};
