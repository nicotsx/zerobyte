import { arktypeResolver } from "@hookform/resolvers/arktype";
import { type } from "arktype";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { cn, slugify } from "~/client/lib/utils";
import { deepClean } from "~/utils/object";
import { Button } from "./ui/button";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "./ui/form";
import { Input } from "./ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { useQuery } from "@tanstack/react-query";
import { Alert, AlertDescription } from "./ui/alert";
import { ExternalLink, AlertTriangle } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";
import { useSystemInfo } from "~/client/hooks/use-system-info";
import { COMPRESSION_MODES, repositoryConfigSchema } from "~/schemas/restic";
import { listRcloneRemotesOptions } from "../api-client/@tanstack/react-query.gen";
import { Checkbox } from "./ui/checkbox";
import { DirectoryBrowser } from "./directory-browser";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "./ui/alert-dialog";
import { Textarea } from "./ui/textarea";

export const formSchema = type({
	name: "2<=string<=32",
	compressionMode: type.valueOf(COMPRESSION_MODES).optional(),
}).and(repositoryConfigSchema);
const cleanSchema = type.pipe((d) => formSchema(deepClean(d)));

export type RepositoryFormValues = typeof formSchema.inferIn;

type Props = {
	onSubmit: (values: RepositoryFormValues) => void;
	mode?: "create" | "update";
	initialValues?: Partial<RepositoryFormValues>;
	formId?: string;
	loading?: boolean;
	className?: string;
};

const defaultValuesForType = {
	local: { backend: "local" as const, compressionMode: "auto" as const },
	s3: { backend: "s3" as const, compressionMode: "auto" as const },
	r2: { backend: "r2" as const, compressionMode: "auto" as const },
	gcs: { backend: "gcs" as const, compressionMode: "auto" as const },
	azure: { backend: "azure" as const, compressionMode: "auto" as const },
	rclone: { backend: "rclone" as const, compressionMode: "auto" as const },
	rest: { backend: "rest" as const, compressionMode: "auto" as const },
	sftp: { backend: "sftp" as const, compressionMode: "auto" as const, port: 22 },
};

export const CreateRepositoryForm = ({
	onSubmit,
	mode = "create",
	initialValues,
	formId,
	loading,
	className,
}: Props) => {
	const form = useForm<RepositoryFormValues>({
		resolver: arktypeResolver(cleanSchema as unknown as typeof formSchema),
		defaultValues: initialValues,
		resetOptions: {
			keepDefaultValues: true,
			keepDirtyValues: false,
		},
	});

	const { watch, setValue } = form;

	const watchedBackend = watch("backend");
	const watchedIsExistingRepository = watch("isExistingRepository");

	const [passwordMode, setPasswordMode] = useState<"default" | "custom">("default");
	const [showPathBrowser, setShowPathBrowser] = useState(false);
	const [showPathWarning, setShowPathWarning] = useState(false);

	const { capabilities } = useSystemInfo();

	const { data: rcloneRemotes, isLoading: isLoadingRemotes } = useQuery({
		...listRcloneRemotesOptions(),
		enabled: capabilities.rclone,
	});

	useEffect(() => {
		form.reset({
			name: form.getValues().name,
			isExistingRepository: form.getValues().isExistingRepository,
			customPassword: form.getValues().customPassword,
			...defaultValuesForType[watchedBackend as keyof typeof defaultValuesForType],
		});
	}, [watchedBackend, form]);

	return (
		<Form {...form}>
			<form id={formId} onSubmit={form.handleSubmit(onSubmit)} className={cn("space-y-4", className)}>
				<FormField
					control={form.control}
					name="name"
					render={({ field }) => (
						<FormItem>
							<FormLabel>Name</FormLabel>
							<FormControl>
								<Input
									{...field}
									placeholder="Repository name"
									onChange={(e) => field.onChange(slugify(e.target.value))}
									max={32}
									min={2}
									disabled={mode === "update"}
									className={mode === "update" ? "bg-gray-50" : ""}
								/>
							</FormControl>
							<FormDescription>Unique identifier for the repository.</FormDescription>
							<FormMessage />
						</FormItem>
					)}
				/>
				<FormField
					control={form.control}
					name="backend"
					render={({ field }) => (
						<FormItem>
							<FormLabel>Backend</FormLabel>
							<Select onValueChange={field.onChange} defaultValue={field.value} value={field.value}>
								<FormControl>
									<SelectTrigger>
										<SelectValue placeholder="Select a backend" />
									</SelectTrigger>
								</FormControl>
								<SelectContent>
									<SelectItem value="local">Local</SelectItem>
									<SelectItem value="s3">S3</SelectItem>
									<SelectItem value="r2">Cloudflare R2</SelectItem>
									<SelectItem value="gcs">Google Cloud Storage</SelectItem>
									<SelectItem value="azure">Azure Blob Storage</SelectItem>
									<SelectItem value="rest">REST Server</SelectItem>
									<SelectItem value="sftp">SFTP</SelectItem>
									<Tooltip>
										<TooltipTrigger>
											<SelectItem disabled={!capabilities.rclone} value="rclone">
												rclone (40+ cloud providers)
											</SelectItem>
										</TooltipTrigger>
										<TooltipContent className={cn({ hidden: capabilities.rclone })}>
											<p>Setup rclone to use this backend</p>
										</TooltipContent>
									</Tooltip>
								</SelectContent>
							</Select>
							<FormDescription>Choose the storage backend for this repository.</FormDescription>
							<FormMessage />
						</FormItem>
					)}
				/>

				<FormField
					control={form.control}
					name="compressionMode"
					render={({ field }) => (
						<FormItem>
							<FormLabel>Compression Mode</FormLabel>
							<Select onValueChange={field.onChange} defaultValue={field.value} value={field.value}>
								<FormControl>
									<SelectTrigger>
										<SelectValue placeholder="Select compression mode" />
									</SelectTrigger>
								</FormControl>
								<SelectContent>
									<SelectItem value="off">Off</SelectItem>
									<SelectItem value="auto">Auto</SelectItem>
									<SelectItem value="fastest">Fastest</SelectItem>
									<SelectItem value="better">Better</SelectItem>
									<SelectItem value="max">Max</SelectItem>
								</SelectContent>
							</Select>
							<FormDescription>Compression mode for backups stored in this repository.</FormDescription>
							<FormMessage />
						</FormItem>
					)}
				/>

				<FormField
					control={form.control}
					name="isExistingRepository"
					render={({ field }) => (
						<FormItem className="flex flex-row items-center space-x-3">
							<FormControl>
								<Checkbox
									checked={field.value}
									onCheckedChange={(checked) => {
										field.onChange(checked);
										if (!checked) {
											setPasswordMode("default");
											setValue("customPassword", undefined);
										}
									}}
								/>
							</FormControl>
							<div className="space-y-1">
								<FormLabel>Import existing repository</FormLabel>
								<FormDescription>Check this if the repository already exists at the specified location</FormDescription>
							</div>
						</FormItem>
					)}
				/>
				{watchedIsExistingRepository && (
					<>
						<FormItem>
							<FormLabel>Repository Password</FormLabel>
							<Select
								onValueChange={(value) => {
									setPasswordMode(value as "default" | "custom");
									if (value === "default") {
										setValue("customPassword", undefined);
									}
								}}
								defaultValue={passwordMode}
								value={passwordMode}
							>
								<FormControl>
									<SelectTrigger>
										<SelectValue placeholder="Select password option" />
									</SelectTrigger>
								</FormControl>
								<SelectContent>
									<SelectItem value="default">Use Zerobyte's password</SelectItem>
									<SelectItem value="custom">Enter password manually</SelectItem>
								</SelectContent>
							</Select>
							<FormDescription>
								Choose whether to use Zerobyte's master password or enter a custom password for the existing repository.
							</FormDescription>
						</FormItem>

						{passwordMode === "custom" && (
							<FormField
								control={form.control}
								name="customPassword"
								render={({ field }) => (
									<FormItem>
										<FormLabel>Repository Password</FormLabel>
										<FormControl>
											<Input type="password" placeholder="Enter repository password" {...field} />
										</FormControl>
										<FormDescription>
											The password used to encrypt this repository. It will be stored securely.
										</FormDescription>
										<FormMessage />
									</FormItem>
								)}
							/>
						)}
					</>
				)}

				{watchedBackend === "local" && (
					<>
						<FormItem>
							<FormLabel>Repository Directory</FormLabel>
							<div className="flex items-center gap-2">
								<div className="flex-1 text-sm font-mono bg-muted px-3 py-2 rounded-md border">
									{form.watch("path") || "/var/lib/zerobyte/repositories"}
								</div>
								<Button type="button" variant="outline" onClick={() => setShowPathWarning(true)} size="sm">
									Change
								</Button>
							</div>
							<FormDescription>The directory where the repository will be stored.</FormDescription>
						</FormItem>

						<AlertDialog open={showPathWarning} onOpenChange={setShowPathWarning}>
							<AlertDialogContent>
								<AlertDialogHeader>
									<AlertDialogTitle className="flex items-center gap-2">
										<AlertTriangle className="h-5 w-5 text-yellow-500" />
										Important: Host Mount Required
									</AlertDialogTitle>
									<AlertDialogDescription className="space-y-3">
										<p>When selecting a custom path, ensure it is mounted from the host machine into the container.</p>
										<p className="font-medium">
											If the path is not a host mount, you will lose your repository data when the container restarts.
										</p>
										<p className="text-sm text-muted-foreground">
											The default path <code className="bg-muted px-1 rounded">/var/lib/zerobyte/repositories</code> is
											already mounted from the host and is safe to use.
										</p>
									</AlertDialogDescription>
								</AlertDialogHeader>
								<AlertDialogFooter>
									<AlertDialogCancel>Cancel</AlertDialogCancel>
									<AlertDialogAction
										onClick={() => {
											setShowPathBrowser(true);
											setShowPathWarning(false);
										}}
									>
										I Understand, Continue
									</AlertDialogAction>
								</AlertDialogFooter>
							</AlertDialogContent>
						</AlertDialog>

						<AlertDialog open={showPathBrowser} onOpenChange={setShowPathBrowser}>
							<AlertDialogContent className="max-w-2xl">
								<AlertDialogHeader>
									<AlertDialogTitle>Select Repository Directory</AlertDialogTitle>
									<AlertDialogDescription>
										Choose a directory from the filesystem to store the repository.
									</AlertDialogDescription>
								</AlertDialogHeader>
								<div className="py-4">
									<DirectoryBrowser
										onSelectPath={(path) => form.setValue("path", path)}
										selectedPath={form.watch("path") || "/var/lib/zerobyte/repositories"}
									/>
								</div>
								<AlertDialogFooter>
									<AlertDialogCancel>Cancel</AlertDialogCancel>
									<AlertDialogAction onClick={() => setShowPathBrowser(false)}>Done</AlertDialogAction>
								</AlertDialogFooter>
							</AlertDialogContent>
						</AlertDialog>
					</>
				)}

				{watchedBackend === "s3" && (
					<>
						<FormField
							control={form.control}
							name="endpoint"
							render={({ field }) => (
								<FormItem>
									<FormLabel>Endpoint</FormLabel>
									<FormControl>
										<Input placeholder="s3.amazonaws.com" {...field} />
									</FormControl>
									<FormDescription>S3-compatible endpoint URL.</FormDescription>
									<FormMessage />
								</FormItem>
							)}
						/>
						<FormField
							control={form.control}
							name="bucket"
							render={({ field }) => (
								<FormItem>
									<FormLabel>Bucket</FormLabel>
									<FormControl>
										<Input placeholder="my-backup-bucket" {...field} />
									</FormControl>
									<FormDescription>S3 bucket name for storing backups.</FormDescription>
									<FormMessage />
								</FormItem>
							)}
						/>
						<FormField
							control={form.control}
							name="accessKeyId"
							render={({ field }) => (
								<FormItem>
									<FormLabel>Access Key ID</FormLabel>
									<FormControl>
										<Input placeholder="AKIAIOSFODNN7EXAMPLE" {...field} />
									</FormControl>
									<FormDescription>S3 access key ID for authentication.</FormDescription>
									<FormMessage />
								</FormItem>
							)}
						/>
						<FormField
							control={form.control}
							name="secretAccessKey"
							render={({ field }) => (
								<FormItem>
									<FormLabel>Secret Access Key</FormLabel>
									<FormControl>
										<Input type="password" placeholder="••••••••" {...field} />
									</FormControl>
									<FormDescription>S3 secret access key for authentication.</FormDescription>
									<FormMessage />
								</FormItem>
							)}
						/>
					</>
				)}

				{watchedBackend === "r2" && (
					<>
						<FormField
							control={form.control}
							name="endpoint"
							render={({ field }) => (
								<FormItem>
									<FormLabel>Endpoint</FormLabel>
									<FormControl>
										<Input placeholder="<account-id>.r2.cloudflarestorage.com" {...field} />
									</FormControl>
									<FormDescription>
										R2 endpoint (without https://). Find in R2 dashboard under bucket settings.
									</FormDescription>
									<FormMessage />
								</FormItem>
							)}
						/>
						<FormField
							control={form.control}
							name="bucket"
							render={({ field }) => (
								<FormItem>
									<FormLabel>Bucket</FormLabel>
									<FormControl>
										<Input placeholder="my-backup-bucket" {...field} />
									</FormControl>
									<FormDescription>R2 bucket name for storing backups.</FormDescription>
									<FormMessage />
								</FormItem>
							)}
						/>
						<FormField
							control={form.control}
							name="accessKeyId"
							render={({ field }) => (
								<FormItem>
									<FormLabel>Access Key ID</FormLabel>
									<FormControl>
										<Input placeholder="Access Key ID from R2 API tokens" {...field} />
									</FormControl>
									<FormDescription>R2 API token Access Key ID (create in Cloudflare R2 dashboard).</FormDescription>
									<FormMessage />
								</FormItem>
							)}
						/>
						<FormField
							control={form.control}
							name="secretAccessKey"
							render={({ field }) => (
								<FormItem>
									<FormLabel>Secret Access Key</FormLabel>
									<FormControl>
										<Input type="password" placeholder="••••••••" {...field} />
									</FormControl>
									<FormDescription>R2 API token Secret Access Key (shown once when creating token).</FormDescription>
									<FormMessage />
								</FormItem>
							)}
						/>
					</>
				)}

				{watchedBackend === "gcs" && (
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
										<Input type="password" placeholder="Paste service account JSON key..." {...field} />
									</FormControl>
									<FormDescription>Service account JSON credentials for authentication.</FormDescription>
									<FormMessage />
								</FormItem>
							)}
						/>
					</>
				)}

				{watchedBackend === "azure" && (
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
				)}

				{watchedBackend === "rclone" &&
					(!rcloneRemotes || rcloneRemotes.length === 0 ? (
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
					) : (
						<>
							<FormField
								control={form.control}
								name="remote"
								render={({ field }) => (
									<FormItem>
										<FormLabel>Remote</FormLabel>
										<Select onValueChange={(v) => field.onChange(v)} defaultValue={field.value} value={field.value}>
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
													rcloneRemotes.map((remote: { name: string; type: string }) => (
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
					))}

				{watchedBackend === "rest" && (
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
				)}

				{watchedBackend === "sftp" && (
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
										<Input placeholder="backups/ironmount" {...field} />
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
					</>
				)}

				{mode === "update" && (
					<Button type="submit" className="w-full" loading={loading}>
						Save Changes
					</Button>
				)}
			</form>
		</Form>
	);
};
