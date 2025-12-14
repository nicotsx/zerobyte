import { ExternalLink } from "lucide-react";
import type { UseFormReturn } from "react-hook-form";
import type { FormValues } from "../create-volume-form";
import {
	FormControl,
	FormDescription,
	FormField,
	FormItem,
	FormLabel,
	FormMessage,
} from "../../../../components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../../../components/ui/select";
import { Alert, AlertDescription } from "../../../../components/ui/alert";
import { Input } from "../../../../components/ui/input";
import { listRcloneRemotesOptions } from "~/client/api-client/@tanstack/react-query.gen";
import { useSystemInfo } from "~/client/hooks/use-system-info";
import { useQuery } from "@tanstack/react-query";

type Props = {
	form: UseFormReturn<FormValues>;
};

export const RcloneForm = ({ form }: Props) => {
	const { capabilities } = useSystemInfo();

	const { data: rcloneRemotes, isPending } = useQuery({
		...listRcloneRemotesOptions(),
		enabled: capabilities.rclone,
	});

	if (!isPending && !rcloneRemotes?.length) {
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
								{isPending ? (
									<SelectItem value="loading" disabled>
										Loading remotes...
									</SelectItem>
								) : (
									rcloneRemotes?.map((remote) => (
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
							<Input placeholder="/" {...field} />
						</FormControl>
						<FormDescription>Path on the remote to mount. Use "/" for the root.</FormDescription>
						<FormMessage />
					</FormItem>
				)}
			/>
			<FormField
				control={form.control}
				name="readOnly"
				defaultValue={false}
				render={({ field }) => (
					<FormItem>
						<FormLabel>Read-only Mode</FormLabel>
						<FormControl>
							<div className="flex items-center space-x-2">
								<input
									type="checkbox"
									checked={field.value ?? false}
									onChange={(e) => field.onChange(e.target.checked)}
									className="rounded border-gray-300"
								/>
								<span className="text-sm">Mount volume as read-only</span>
							</div>
						</FormControl>
						<FormDescription>
							Prevent any modifications to the volume. Recommended for backup sources and sensitive data.
						</FormDescription>
						<FormMessage />
					</FormItem>
				)}
			/>
		</>
	);
};
