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
import { Input } from "../../../../components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../../../components/ui/select";

type Props = {
	form: UseFormReturn<FormValues>;
};

export const NFSForm = ({ form }: Props) => {
	return (
		<>
			<FormField
				control={form.control}
				name="server"
				render={({ field }) => (
					<FormItem>
						<FormLabel>Server</FormLabel>
						<FormControl>
							<Input placeholder="192.168.1.100" {...field} />
						</FormControl>
						<FormDescription>NFS server IP address or hostname.</FormDescription>
						<FormMessage />
					</FormItem>
				)}
			/>
			<FormField
				control={form.control}
				name="exportPath"
				render={({ field }) => (
					<FormItem>
						<FormLabel>Export Path</FormLabel>
						<FormControl>
							<Input placeholder="/export/data" {...field} />
						</FormControl>
						<FormDescription>Path to the NFS export on the server.</FormDescription>
						<FormMessage />
					</FormItem>
				)}
			/>
			<FormField
				control={form.control}
				name="port"
				defaultValue={2049}
				render={({ field }) => (
					<FormItem>
						<FormLabel>Port</FormLabel>
						<FormControl>
							<Input
								type="number"
								placeholder="2049"
								{...field}
								onChange={(e) => field.onChange(parseInt(e.target.value, 10) || undefined)}
							/>
						</FormControl>
						<FormDescription>NFS server port (default: 2049).</FormDescription>
						<FormMessage />
					</FormItem>
				)}
			/>
			<FormField
				control={form.control}
				name="version"
				defaultValue="4.1"
				render={({ field }) => (
					<FormItem>
						<FormLabel>Version</FormLabel>
						<Select onValueChange={field.onChange} defaultValue="4.1">
							<FormControl>
								<SelectTrigger>
									<SelectValue placeholder="Select NFS version" />
								</SelectTrigger>
							</FormControl>
							<SelectContent>
								<SelectItem value="3">NFS v3</SelectItem>
								<SelectItem value="4">NFS v4</SelectItem>
								<SelectItem value="4.1">NFS v4.1</SelectItem>
							</SelectContent>
						</Select>
						<FormDescription>NFS protocol version to use.</FormDescription>
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
