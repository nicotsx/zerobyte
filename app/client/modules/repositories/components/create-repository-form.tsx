import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { Save } from "lucide-react";
import { z } from "zod";
import { cn } from "~/client/lib/utils";
import { Button } from "../../../components/ui/button";
import {
	Form,
	FormControl,
	FormDescription,
	FormField,
	FormItem,
	FormLabel,
	FormMessage,
} from "../../../components/ui/form";
import { Input } from "../../../components/ui/input";
import { SecretInput } from "../../../components/ui/secret-input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../../components/ui/select";
import { useSystemInfo } from "~/client/hooks/use-system-info";
import { useScrollToFormError } from "~/client/hooks/use-scroll-to-form-error";
import {
	COMPRESSION_MODES,
	azureRepositoryConfigSchema,
	gcsRepositoryConfigSchema,
	localRepositoryConfigSchema,
	r2RepositoryConfigSchema,
	rcloneRepositoryConfigSchema,
	restRepositoryConfigSchema,
	s3RepositoryConfigSchema,
	sftpRepositoryConfigSchema,
	type RepositoryBackend,
} from "@zerobyte/core/restic";
import { Checkbox } from "../../../components/ui/checkbox";
import {
	LocalRepositoryForm,
	S3RepositoryForm,
	R2RepositoryForm,
	GCSRepositoryForm,
	AzureRepositoryForm,
	RcloneRepositoryForm,
	RestRepositoryForm,
	SftpRepositoryForm,
	AdvancedForm,
} from "./repository-forms";
import { useServerFn } from "@tanstack/react-start";
import { getServerConstants } from "~/server/lib/functions/server-constants";
import { useSuspenseQuery } from "@tanstack/react-query";

const formBaseFields = {
	name: z.string().min(2).max(32),
	compressionMode: z.enum(COMPRESSION_MODES).optional(),
	autoCheckEnabled: z.boolean().default(true),
};

export const formSchema = z
	.discriminatedUnion("backend", [
		localRepositoryConfigSchema.extend(formBaseFields),
		s3RepositoryConfigSchema.extend(formBaseFields),
		r2RepositoryConfigSchema.extend(formBaseFields),
		gcsRepositoryConfigSchema.extend(formBaseFields),
		azureRepositoryConfigSchema.extend(formBaseFields),
		rcloneRepositoryConfigSchema.extend(formBaseFields),
		restRepositoryConfigSchema.extend(formBaseFields),
		sftpRepositoryConfigSchema.extend(formBaseFields),
	])
	.superRefine((value, ctx) => {
		if (value.backend === "sftp" && !value.skipHostKeyCheck && !value.knownHosts?.trim()) {
			ctx.addIssue({
				code: "custom",
				message: "Known hosts are required unless host key verification is skipped",
				path: ["knownHosts"],
			});
		}
	});

export type RepositoryFormValues = z.input<typeof formSchema>;

type Props = {
	onSubmit: (values: RepositoryFormValues) => void;
	mode?: "create" | "update";
	initialValues?: Partial<RepositoryFormValues>;
	formId?: string;
	loading?: boolean;
	className?: string;
};

const defaultValuesForType = (repoBase: string) => ({
	local: { backend: "local" as const, compressionMode: "auto" as const, path: repoBase },
	s3: { backend: "s3" as const, compressionMode: "auto" as const },
	r2: { backend: "r2" as const, compressionMode: "auto" as const },
	gcs: { backend: "gcs" as const, compressionMode: "auto" as const },
	azure: { backend: "azure" as const, compressionMode: "auto" as const },
	rclone: { backend: "rclone" as const, compressionMode: "auto" as const },
	rest: { backend: "rest" as const, compressionMode: "auto" as const },
	sftp: {
		backend: "sftp" as const,
		compressionMode: "auto" as const,
		port: 22,
		skipHostKeyCheck: false,
		allowLegacySshRsa: false,
	},
});

export const CreateRepositoryForm = ({
	onSubmit,
	mode = "create",
	initialValues,
	formId,
	loading,
	className,
}: Props) => {
	const formDefaultValues = initialValues ?? { autoCheckEnabled: true };
	const getConstants = useServerFn(getServerConstants);
	const { data: constants } = useSuspenseQuery({
		queryKey: ["server-constants"],
		queryFn: getConstants,
	});

	const form = useForm<RepositoryFormValues>({
		resolver: zodResolver(formSchema, undefined, { raw: true }),
		defaultValues: formDefaultValues,
		resetOptions: {
			keepDefaultValues: true,
			keepDirtyValues: false,
		},
	});

	const { watch, setValue } = form;

	const backend = watch("backend");
	const isExisting = watch("isExistingRepository");
	const exactPath = mode === "update" || isExisting === true;

	const [passwordMode, setPasswordMode] = useState<"default" | "custom">("default");

	const { capabilities } = useSystemInfo();
	const isBackendAllowed = (backend: RepositoryBackend) => capabilities.repositoryBackends.includes(backend);
	const scrollToFirstError = useScrollToFormError();

	return (
		<Form {...form}>
			<form
				id={formId}
				onSubmit={form.handleSubmit(onSubmit, scrollToFirstError)}
				className={cn("space-y-4", className)}
			>
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
									onChange={(e) => field.onChange(e.target.value)}
									maxLength={32}
									minLength={2}
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
							<Select
								onValueChange={(value) => {
									const currentValues = form.getValues();
									const selectedBackend = value as keyof ReturnType<typeof defaultValuesForType>;
									const backendDefaultValues = defaultValuesForType(constants.REPOSITORY_BASE)[
										selectedBackend
									];
									const autoCheckEnabled = currentValues.autoCheckEnabled ?? true;
									const resetValues = {
										name: currentValues.name,
										isExistingRepository: currentValues.isExistingRepository,
										customPassword: currentValues.customPassword,
										autoCheckEnabled,
										...backendDefaultValues,
									};
									field.onChange(value);
									form.reset(resetValues);
								}}
								value={field.value ?? ""}
								disabled={mode === "update"}
							>
								<FormControl>
									<SelectTrigger>
										<SelectValue placeholder="Select a backend" />
									</SelectTrigger>
								</FormControl>
								<SelectContent>
									{isBackendAllowed("local") && <SelectItem value="local">Local</SelectItem>}
									{isBackendAllowed("s3") && <SelectItem value="s3">S3</SelectItem>}
									{isBackendAllowed("r2") && <SelectItem value="r2">Cloudflare R2</SelectItem>}
									{isBackendAllowed("gcs") && (
										<SelectItem value="gcs">Google Cloud Storage</SelectItem>
									)}
									{isBackendAllowed("azure") && (
										<SelectItem value="azure">Azure Blob Storage</SelectItem>
									)}
									{isBackendAllowed("rest") && <SelectItem value="rest">REST Server</SelectItem>}
									{isBackendAllowed("sftp") && <SelectItem value="sftp">SFTP</SelectItem>}
									{isBackendAllowed("rclone") && (
										<SelectItem value="rclone">rclone (40+ cloud providers)</SelectItem>
									)}
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
							<Select onValueChange={field.onChange} value={field.value ?? ""}>
								<FormControl>
									<SelectTrigger>
										<SelectValue placeholder="Select compression mode" />
									</SelectTrigger>
								</FormControl>
								<SelectContent>
									<SelectItem value="off">Off</SelectItem>
									<SelectItem value="auto">Auto (fast)</SelectItem>
									<SelectItem value="max">Max (slower, better compression)</SelectItem>
								</SelectContent>
							</Select>
							<FormDescription>Compression mode for backups stored in this repository.</FormDescription>
							<FormMessage />
						</FormItem>
					)}
				/>

				<FormField
					control={form.control}
					name="autoCheckEnabled"
					render={({ field }) => (
						<FormItem className="flex flex-row items-center space-x-3">
							<FormControl>
								<Checkbox
									checked={field.value}
									onCheckedChange={(checked) => {
										const autoCheckEnabled = checked === true;
										field.onChange(autoCheckEnabled);
									}}
								/>
							</FormControl>
							<div className="space-y-1">
								<FormLabel>Enable scheduled repository health checks</FormLabel>
								<FormDescription>
									Automatically run scheduled health checks for this repository. This does not affect
									manual health checks.
								</FormDescription>
							</div>
						</FormItem>
					)}
				/>

				{mode === "create" && (
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
									<FormDescription>
										Check this if the repository already exists at the specified location
									</FormDescription>
								</div>
							</FormItem>
						)}
					/>
				)}
				{isExisting && (
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
									<SelectItem value="default">Use the existing recovery key</SelectItem>
									<SelectItem value="custom">Enter password manually</SelectItem>
								</SelectContent>
							</Select>
							<FormDescription>
								Choose whether to use Zerobyte's recovery key (which you downloaded when creating your
								account) or enter a custom password for the existing repository.
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
											<SecretInput
												placeholder="Enter repository password"
												value={field.value ?? ""}
												onChange={field.onChange}
											/>
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

				{backend === "local" && <LocalRepositoryForm form={form} exactPath={exactPath} />}
				{backend === "s3" && <S3RepositoryForm form={form} />}
				{backend === "r2" && <R2RepositoryForm form={form} />}
				{backend === "gcs" && <GCSRepositoryForm form={form} />}
				{backend === "azure" && <AzureRepositoryForm form={form} />}
				{backend === "rclone" && <RcloneRepositoryForm form={form} />}
				{backend === "rest" && <RestRepositoryForm form={form} />}
				{backend === "sftp" && <SftpRepositoryForm form={form} />}

				{backend && backend !== "local" && <AdvancedForm form={form} />}

				{mode === "update" && (
					<Button type="submit" className="w-full" loading={loading}>
						<Save className="h-4 w-4 mr-2" />
						Save Changes
					</Button>
				)}
			</form>
		</Form>
	);
};
