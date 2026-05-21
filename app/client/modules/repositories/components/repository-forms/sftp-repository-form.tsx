import { useWatch, type UseFormReturn } from "react-hook-form";
import { useState } from "react";
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
import { Button } from "~/client/components/ui/button";
import { generatePrivateKeyPem, generateSshKeyPairPem } from "~/utils/ssh";

type Props = {
	form: UseFormReturn<RepositoryFormValues>;
};

export const SftpRepositoryForm = ({ form }: Props) => {
	const skipHostKeyCheck = useWatch({ control: form.control, name: "skipHostKeyCheck" });
	const [isGeneratingKey, setIsGeneratingKey] = useState(false);
	const [keyGenerationError, setKeyGenerationError] = useState<string | null>(null);
	const [generatedPublicKey, setGeneratedPublicKey] = useState<string | null>(null);
	const [copyPublicKeyMessage, setCopyPublicKeyMessage] = useState<string | null>(null);

	const handleGenerateKey = async () => {
		setIsGeneratingKey(true);
		setKeyGenerationError(null);

		try {
			const { privateKeyPem, publicKeyPem } = await generateSshKeyPairPem();
			form.setValue("privateKey", privateKeyPem, {
				shouldDirty: true,
				shouldTouch: true,
				shouldValidate: true,
			});
			setGeneratedPublicKey(publicKeyPem);
		} catch {
			setGeneratedPublicKey(null);
			setKeyGenerationError("Could not generate SSH key in this browser.");
		} finally {
			setIsGeneratingKey(false);
		}
	};

	const handleCopyPublicKey = async () => {
		setCopyPublicKeyMessage(null);
		if (!generatedPublicKey) {
			setKeyGenerationError("Generate a key first to copy its public key.");
			return;
		}
		try {
			await navigator.clipboard.writeText(generatedPublicKey);
			setCopyPublicKeyMessage("Public key copied to clipboard.");
		} catch {
			setKeyGenerationError("Could not copy public key to clipboard.");
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
						<div className="flex flex-wrap gap-2">
							<Button
								type="button"
								variant="outline"
								size="sm"
								onClick={() => void handleGenerateKey()}
								disabled={isGeneratingKey}
							>
								{isGeneratingKey ? "Generating..." : "Generate SSH Key Pair"}
							</Button>
							<Button
								type="button"
								variant="outline"
								size="sm"
								onClick={() => void handleCopyPublicKey()}
								disabled={isGeneratingKey || !generatedPublicKey}
							>
								Copy Public Key
							</Button>
						</div>
						<FormDescription>The key is generated privately in your browser. Don't forget to save it!</FormDescription>
						{keyGenerationError && <FormMessage className="text-xs text-destructive">{keyGenerationError}</FormMessage>}
						{copyPublicKeyMessage && <FormMessage className="text-xs text-success">{copyPublicKeyMessage}</FormMessage>}
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
