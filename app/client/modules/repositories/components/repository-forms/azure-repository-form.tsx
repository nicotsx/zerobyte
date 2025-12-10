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

export const AzureRepositoryForm = ({ form }: Props) => {
	return (
		<>
			<FormField
				control={form.control}
				name="container"
				render={({ field }) => (
					<FormItem>
						<FormLabel>Container</FormLabel>
						<FormControl>
							<Input placeholder="my-backup-container" {...field} />
						</FormControl>
						<FormDescription>Azure Blob Storage container name for storing backups.</FormDescription>
						<FormMessage />
					</FormItem>
				)}
			/>
			<FormField
				control={form.control}
				name="accountName"
				render={({ field }) => (
					<FormItem>
						<FormLabel>Account Name</FormLabel>
						<FormControl>
							<Input placeholder="mystorageaccount" {...field} />
						</FormControl>
						<FormDescription>Azure Storage account name.</FormDescription>
						<FormMessage />
					</FormItem>
				)}
			/>
			<FormField
				control={form.control}
				name="accountKey"
				render={({ field }) => (
					<FormItem>
						<FormLabel>Account Key</FormLabel>
						<FormControl>
							<Input type="password" placeholder="••••••••" {...field} />
						</FormControl>
						<FormDescription>Azure Storage account key for authentication.</FormDescription>
						<FormMessage />
					</FormItem>
				)}
			/>
			<FormField
				control={form.control}
				name="endpointSuffix"
				render={({ field }) => (
					<FormItem>
						<FormLabel>Endpoint Suffix (Optional)</FormLabel>
						<FormControl>
							<Input placeholder="core.windows.net" {...field} />
						</FormControl>
						<FormDescription>Custom Azure endpoint suffix (defaults to core.windows.net).</FormDescription>
						<FormMessage />
					</FormItem>
				)}
			/>
		</>
	);
};
