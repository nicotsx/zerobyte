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
import { Switch } from "../../../../components/ui/switch";
import type { RepositoryFormValues } from "../create-repository-form";

type Props = {
	form: UseFormReturn<RepositoryFormValues>;
};

export const SftpRepositoryForm = ({ form }: Props) => {
	return (
		<>
			<FormField
				control={form.control}
				name="host"
				render={({ field }) => (
					<FormItem>
						<FormLabel>Host</FormLabel>
						<FormControl>
							<Input placeholder="192.168.1.100" {...field} />
						</FormControl>
						<FormDescription>SFTP server hostname or IP address.</FormDescription>
						<FormMessage />
					</FormItem>
				)}
			/>
			<FormField
				control={form.control}
				name="port"
				render={({ field }) => (
					<FormItem>
						<FormLabel>Port</FormLabel>
						<FormControl>
							<Input
								type="number"
								placeholder="22"
								{...field}
								onChange={(e) => field.onChange(parseInt(e.target.value, 10))}
							/>
						</FormControl>
						<FormDescription>SSH port (default: 22).</FormDescription>
						<FormMessage />
					</FormItem>
				)}
			/>
			<FormField
				control={form.control}
				name="user"
				render={({ field }) => (
					<FormItem>
						<FormLabel>User</FormLabel>
						<FormControl>
							<Input placeholder="backup-user" {...field} />
						</FormControl>
						<FormDescription>SSH username for authentication.</FormDescription>
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
						<FormDescription>Repository path on the SFTP server. </FormDescription>
						<FormMessage />
					</FormItem>
				)}
			/>
			<FormField
				control={form.control}
				name="privateKey"
				render={({ field }) => (
					<FormItem>
						<FormLabel>SSH Private Key</FormLabel>
						<FormControl>
							<Textarea
								{...field}
								placeholder="-----BEGIN OPENSSH PRIVATE KEY-----&#10;...&#10;-----END OPENSSH PRIVATE KEY-----"
							/>
						</FormControl>
						<FormDescription>Paste the contents of your SSH private key.</FormDescription>
						<FormMessage />
					</FormItem>
				)}
			/>
			<FormField
				control={form.control}
				name="skipHostKeyCheck"
				render={({ field }) => (
					<FormItem className="flex flex-row items-center justify-between rounded-lg border p-3 shadow-sm">
						<div className="space-y-0.5">
							<FormLabel>Skip Host Key Verification</FormLabel>
							<FormDescription>
								Disable SSH host key checking. Useful for servers with dynamic IPs or self-signed keys.
							</FormDescription>
						</div>
						<FormControl>
							<Switch checked={field.value} onCheckedChange={field.onChange} />
						</FormControl>
					</FormItem>
				)}
			/>
			{!form.watch("skipHostKeyCheck") && (
				<FormField
					control={form.control}
					name="knownHosts"
					render={({ field }) => (
						<FormItem>
							<FormLabel>Known Hosts</FormLabel>
							<FormControl>
								<Textarea
									placeholder="example.com ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIJ..."
									className="font-mono text-xs"
									rows={3}
									{...field}
									value={field.value ?? ""}
								/>
							</FormControl>
							<FormDescription>
								The contents of the <code>known_hosts</code> file for this server.
							</FormDescription>
							<FormMessage />
						</FormItem>
					)}
				/>
			)}
		</>
	);
};
