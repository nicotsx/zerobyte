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

export const SMBForm = ({ form }: Props) => {
	return (
		<>
			<FormField
				control={form.control}
				name="server"
				render={({ field }) => (
					<FormItem>
						<FormLabel>Server</FormLabel>
						<FormControl>
							<Input placeholder="192.168.1.100" value={field.value} onChange={field.onChange} />
						</FormControl>
						<FormDescription>SMB server IP address or hostname.</FormDescription>
						<FormMessage />
					</FormItem>
				)}
			/>
			<FormField
				control={form.control}
				name="share"
				render={({ field }) => (
					<FormItem>
						<FormLabel>Share</FormLabel>
						<FormControl>
							<Input placeholder="myshare" value={field.value} onChange={field.onChange} />
						</FormControl>
						<FormDescription>SMB share name on the server.</FormDescription>
						<FormMessage />
					</FormItem>
				)}
			/>
			<FormField
				control={form.control}
				name="username"
				render={({ field }) => (
					<FormItem>
						<FormLabel>Username</FormLabel>
						<FormControl>
							<Input placeholder="admin" value={field.value} onChange={field.onChange} />
						</FormControl>
						<FormDescription>Username for SMB authentication.</FormDescription>
						<FormMessage />
					</FormItem>
				)}
			/>
			<FormField
				control={form.control}
				name="password"
				render={({ field }) => (
					<FormItem>
						<FormLabel>Password</FormLabel>
						<FormControl>
							<Input type="password" placeholder="••••••••" value={field.value} onChange={field.onChange} />
						</FormControl>
						<FormDescription>Password for SMB authentication.</FormDescription>
						<FormMessage />
					</FormItem>
				)}
			/>
			<FormField
				control={form.control}
				name="vers"
				defaultValue="3.0"
				render={({ field }) => (
					<FormItem>
						<FormLabel>SMB Version</FormLabel>
						<Select onValueChange={field.onChange} value={field.value}>
							<FormControl>
								<SelectTrigger>
									<SelectValue placeholder="Select SMB version" />
								</SelectTrigger>
							</FormControl>
							<SelectContent>
								<SelectItem value="1.0">SMB v1.0</SelectItem>
								<SelectItem value="2.0">SMB v2.0</SelectItem>
								<SelectItem value="2.1">SMB v2.1</SelectItem>
								<SelectItem value="3.0">SMB v3.0</SelectItem>
							</SelectContent>
						</Select>
						<FormDescription>SMB protocol version to use (default: 3.0).</FormDescription>
						<FormMessage />
					</FormItem>
				)}
			/>
			<FormField
				control={form.control}
				name="domain"
				render={({ field }) => (
					<FormItem>
						<FormLabel>Domain (Optional)</FormLabel>
						<FormControl>
							<Input placeholder="WORKGROUP" value={field.value} onChange={field.onChange} />
						</FormControl>
						<FormDescription>Domain or workgroup for authentication (optional).</FormDescription>
						<FormMessage />
					</FormItem>
				)}
			/>
			<FormField
				control={form.control}
				name="port"
				defaultValue={445}
				render={({ field }) => (
					<FormItem>
						<FormLabel>Port</FormLabel>
						<FormControl>
							<Input
								type="number"
								placeholder="445"
								value={field.value}
								onChange={(e) => field.onChange(parseInt(e.target.value, 10) || undefined)}
							/>
						</FormControl>
						<FormDescription>SMB server port (default: 445).</FormDescription>
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
