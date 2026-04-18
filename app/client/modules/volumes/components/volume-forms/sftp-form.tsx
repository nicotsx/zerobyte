import { useWatch, type UseFormReturn } from "react-hook-form";
import { useState } from "react";
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
import { SecretInput } from "../../../../components/ui/secret-input";
import { Textarea } from "../../../../components/ui/textarea";
import { Switch } from "../../../../components/ui/switch";
import { Button } from "~/client/components/ui/button";

type Props = {
	form: UseFormReturn<FormValues>;
};

const arrayBufferToBase64 = (buffer: ArrayBuffer) => {
	let binary = "";
	const bytes = new Uint8Array(buffer);
	const chunkSize = 0x8000;

	for (let i = 0; i < bytes.length; i += chunkSize) {
		binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
	}

	return btoa(binary);
};

const toPem = (base64: string, label: string) => {
	const wrapped = base64.match(/.{1,64}/g)?.join("\n") ?? base64;
	return `-----BEGIN ${label}-----\n${wrapped}\n-----END ${label}-----`;
};

const generatePrivateKeyPem = async () => {
	const keyPair = await crypto.subtle.generateKey(
		{
			name: "RSASSA-PKCS1-v1_5",
			modulusLength: 4096,
			publicExponent: new Uint8Array([1, 0, 1]),
			hash: "SHA-256",
		},
		true,
		["sign", "verify"],
	);

	const privateKey = await crypto.subtle.exportKey("pkcs8", keyPair.privateKey);
	return toPem(arrayBufferToBase64(privateKey), "OPENSSH PRIVATE KEY");
};

export const SFTPForm = ({ form }: Props) => {
	const skipHostKeyCheck = useWatch({ control: form.control, name: "skipHostKeyCheck" });
	const [isGeneratingKey, setIsGeneratingKey] = useState(false);
	const [keyGenerationError, setKeyGenerationError] = useState<string | null>(null);

	const handleGenerateKey = async () => {
		setIsGeneratingKey(true);
		setKeyGenerationError(null);

		try {
			const privateKey = await generatePrivateKeyPem();
			form.setValue("privateKey", privateKey, {
				shouldDirty: true,
				shouldTouch: true,
				shouldValidate: true,
			});
		} catch {
			setKeyGenerationError("Could not generate SSH key in this browser.");
		} finally {
			setIsGeneratingKey(false);
		}
	};

	return (
		<>
			<FormField
				control={form.control}
				name="host"
				render={({ field }) => (
					<FormItem>
						<FormLabel>Host</FormLabel>
						<FormControl>
							<Input placeholder="example.com" {...field} />
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
								onChange={(e) => field.onChange(parseInt(e.target.value, 10) || undefined)}
							/>
						</FormControl>
						<FormDescription>SFTP server port (default: 22).</FormDescription>
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
							<Input placeholder="root" {...field} />
						</FormControl>
						<FormDescription>Username for SFTP authentication.</FormDescription>
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
							<SecretInput placeholder="••••••••" value={field.value ?? ""} onChange={field.onChange} />
						</FormControl>
						<FormDescription>Password for SFTP authentication (optional if using private key).</FormDescription>
						<FormMessage />
					</FormItem>
				)}
			/>
			<FormField
				control={form.control}
				name="privateKey"
				render={({ field }) => (
					<FormItem>
						<FormLabel>Private Key (Optional)</FormLabel>
						<FormControl>
							<Textarea
								placeholder="-----BEGIN OPENSSH PRIVATE KEY-----"
								className="font-mono text-xs"
								rows={5}
								{...field}
								value={field.value ?? ""}
							/>
						</FormControl>
						<FormDescription>SSH private key for authentication (optional if using password).</FormDescription>
						<FormMessage />
						<Button
							type="button"
							variant="outline"
							size="sm"
							onClick={() => void handleGenerateKey()}
							disabled={isGeneratingKey}
						>
							{isGeneratingKey ? "Generating..." : "Generate SSH Private Key"}
						</Button>
						<FormDescription>The key is generated privately in your browser. Don't forget to save it!</FormDescription>
						{keyGenerationError && <FormMessage className="text-xs text-destructive">{keyGenerationError}</FormMessage>}
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
							<Input placeholder="/backups" {...field} />
						</FormControl>
						<FormDescription>Path to the directory on the SFTP server.</FormDescription>
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
			{!skipHostKeyCheck && (
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
