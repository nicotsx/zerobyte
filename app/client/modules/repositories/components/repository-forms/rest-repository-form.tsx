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
							<Input type="password" placeholder="••••••••" {...field} />
						</FormControl>
						<FormDescription>Password for REST server authentication.</FormDescription>
						<FormMessage />
					</FormItem>
				)}
			/>
		</>
	);
};
