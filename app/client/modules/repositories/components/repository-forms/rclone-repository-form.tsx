import type { UseFormReturn } from "react-hook-form";
import { useQuery } from "@tanstack/react-query";
import { ExternalLink } from "lucide-react";
import {
	FormControl,
	FormDescription,
	FormField,
	FormItem,
	FormLabel,
	FormMessage,
} from "../../../../components/ui/form";
import { Input } from "../../../../components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../../../components/ui/select";
import { Alert, AlertDescription } from "../../../../components/ui/alert";
import { listRcloneRemotesOptions } from "../../../../api-client/@tanstack/react-query.gen";
import type { RepositoryFormValues } from "../create-repository-form";

type Props = {
	form: UseFormReturn<RepositoryFormValues>;
};

export const RcloneRepositoryForm = ({ form }: Props) => {
	const { data: rcloneRemotes, isLoading: isLoadingRemotes } = useQuery(listRcloneRemotesOptions());

	if (!isLoadingRemotes && (!rcloneRemotes || rcloneRemotes.length === 0)) {
		return (
			<Alert>
				<AlertDescription className="space-y-2">
					<p className="font-medium">No rclone remotes configured</p>
					<p className="text-sm text-muted-foreground">
						To use rclone, you need to configure remotes on your host system
					</p>
					<a
						href="https://rclone.org/docs/"
						target="_blank"
						rel="noopener noreferrer"
						className="text-sm text-strong-accent inline-flex items-center gap-1"
					>
						View rclone documentation
						<ExternalLink className="w-3 h-3" />
					</a>
				</AlertDescription>
			</Alert>
		);
	}

	return (
		<>
			<FormField
				control={form.control}
				name="remote"
				render={({ field }) => (
					<FormItem>
						<FormLabel>Remote</FormLabel>
						<Select onValueChange={(v) => field.onChange(v)} value={field.value}>
							<FormControl>
								<SelectTrigger>
									<SelectValue placeholder="Select an rclone remote" />
								</SelectTrigger>
							</FormControl>
							<SelectContent>
								{isLoadingRemotes ? (
									<SelectItem value="loading" disabled>
										Loading remotes...
									</SelectItem>
								) : (
									rcloneRemotes?.map((remote: { name: string; type: string }) => (
										<SelectItem key={remote.name} value={remote.name}>
											{remote.name} ({remote.type})
										</SelectItem>
									))
								)}
							</SelectContent>
						</Select>
						<FormDescription>Select the rclone remote configured on your host system.</FormDescription>
						<FormMessage />
					</FormItem>
				)}
			/>
			<FormField
				control={form.control}
				name="path"
				render={({ field }) => (
					<FormItem>
						<FormLabel>Path</FormLabel>
						<FormControl>
							<Input placeholder="backups/zerobyte" {...field} />
						</FormControl>
						<FormDescription>Path within the remote where backups will be stored.</FormDescription>
						<FormMessage />
					</FormItem>
				)}
			/>
		</>
	);
};
