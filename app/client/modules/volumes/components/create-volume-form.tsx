import { arktypeResolver } from "@hookform/resolvers/arktype";
import { useMutation } from "@tanstack/react-query";
import { type } from "arktype";
import { CheckCircle, Loader2, Plug, Save, XCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { cn, slugify } from "~/client/lib/utils";
import { deepClean } from "~/utils/object";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../../components/ui/select";
import { volumeConfigSchemaBase } from "~/schemas/volumes";
import { testConnectionMutation } from "../../../api-client/@tanstack/react-query.gen";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../../components/ui/tooltip";
import { useSystemInfo } from "~/client/hooks/use-system-info";
import { DirectoryForm, NFSForm, SMBForm, WebDAVForm, RcloneForm, SFTPForm } from "./volume-forms";

export const formSchema = type({
	name: "2<=string<=32",
}).and(volumeConfigSchemaBase);
const cleanSchema = type.pipe((d) => formSchema(deepClean(d)));

export type FormValues = typeof formSchema.inferIn;

type Props = {
	onSubmit: (values: FormValues) => void;
	mode?: "create" | "update";
	initialValues?: Partial<FormValues>;
	formId?: string;
	loading?: boolean;
	className?: string;
};

const defaultValuesForType = {
	directory: { backend: "directory" as const, path: "/" },
	nfs: { backend: "nfs" as const, port: 2049, version: "4.1" as const },
	smb: { backend: "smb" as const, port: 445, vers: "3.0" as const },
	webdav: { backend: "webdav" as const, port: 80, ssl: false, path: "/webdav" },
	rclone: { backend: "rclone" as const, path: "/" },
	sftp: { backend: "sftp" as const, port: 22, path: "/" },
};

export const CreateVolumeForm = ({ onSubmit, mode = "create", initialValues, formId, loading, className }: Props) => {
	const form = useForm<FormValues>({
		resolver: arktypeResolver(cleanSchema as unknown as typeof formSchema),
		defaultValues: initialValues || {
			name: "",
			backend: "directory",
		},
		resetOptions: {
			keepDefaultValues: true,
			keepDirtyValues: false,
		},
	});

	const { watch, getValues } = form;

	const { capabilities } = useSystemInfo();
	const watchedBackend = watch("backend");

	useEffect(() => {
		if (mode === "create") {
			form.reset({
				name: form.getValues().name,
				...defaultValuesForType[watchedBackend as keyof typeof defaultValuesForType],
			});
		}
	}, [watchedBackend, form, mode]);

	const [testMessage, setTestMessage] = useState<{ success: boolean; message: string } | null>(null);

	const testBackendConnection = useMutation({
		...testConnectionMutation(),
		onMutate: () => {
			setTestMessage(null);
		},
		onError: (error) => {
			setTestMessage({
				success: false,
				message: error?.message || "Failed to test connection. Please try again.",
			});
		},
		onSuccess: (data) => {
			setTestMessage(data);
		},
	});

	const handleTestConnection = async () => {
		const formValues = getValues();

		if (
			formValues.backend === "nfs" ||
			formValues.backend === "smb" ||
			formValues.backend === "webdav" ||
			formValues.backend === "sftp"
		) {
			testBackendConnection.mutate({
				body: { config: formValues },
			});
		}
	};

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
									placeholder="Volume name"
									onChange={(e) => field.onChange(slugify(e.target.value))}
									maxLength={32}
									minLength={2}
								/>
							</FormControl>
							<FormDescription>Unique identifier for the volume.</FormDescription>
							<FormMessage />
						</FormItem>
					)}
				/>
				<FormField
					control={form.control}
					name="backend"
					defaultValue="directory"
					render={({ field }) => (
						<FormItem>
							<FormLabel>Backend</FormLabel>
							<Select onValueChange={field.onChange} value={field.value}>
								<FormControl>
									<SelectTrigger>
										<SelectValue placeholder="Select a backend" />
									</SelectTrigger>
								</FormControl>
								<SelectContent>
									<SelectItem value="directory">Directory</SelectItem>
									<Tooltip>
										<TooltipTrigger asChild>
											<div>
												<SelectItem disabled={!capabilities.sysAdmin} value="nfs">
													NFS
												</SelectItem>
											</div>
										</TooltipTrigger>
										<TooltipContent className={cn({ hidden: capabilities.sysAdmin })}>
											<p>Remote mounts require SYS_ADMIN capability</p>
										</TooltipContent>
									</Tooltip>
									<Tooltip>
										<TooltipTrigger asChild>
											<div>
												<SelectItem disabled={!capabilities.sysAdmin} value="smb">
													SMB
												</SelectItem>
											</div>
										</TooltipTrigger>
										<TooltipContent className={cn({ hidden: capabilities.sysAdmin })}>
											<p>Remote mounts require SYS_ADMIN capability</p>
										</TooltipContent>
									</Tooltip>
									<Tooltip>
										<TooltipTrigger asChild>
											<div>
												<SelectItem disabled={!capabilities.sysAdmin} value="webdav">
													WebDAV
												</SelectItem>
											</div>
										</TooltipTrigger>
										<TooltipContent className={cn({ hidden: capabilities.sysAdmin })}>
											<p>Remote mounts require SYS_ADMIN capability</p>
										</TooltipContent>
									</Tooltip>
									<Tooltip>
										<TooltipTrigger asChild>
											<div>
												<SelectItem disabled={!capabilities.sysAdmin} value="sftp">
													SFTP
												</SelectItem>
											</div>
										</TooltipTrigger>
										<TooltipContent className={cn({ hidden: capabilities.sysAdmin })}>
											<p>Remote mounts require SYS_ADMIN capability</p>
										</TooltipContent>
									</Tooltip>
									<Tooltip>
										<TooltipTrigger asChild>
											<div>
												<SelectItem disabled={!capabilities.rclone || !capabilities.sysAdmin} value="rclone">
													rclone
												</SelectItem>
											</div>
										</TooltipTrigger>
										<TooltipContent className={cn({ hidden: capabilities.sysAdmin })}>
											<p>Remote mounts require SYS_ADMIN capability</p>
										</TooltipContent>
										<TooltipContent className={cn({ hidden: !capabilities.sysAdmin || capabilities.rclone })}>
											<p>Setup rclone to use this backend</p>
										</TooltipContent>
									</Tooltip>
								</SelectContent>
							</Select>
							<FormDescription>Choose the storage backend for this volume.</FormDescription>
							<FormMessage />
						</FormItem>
					)}
				/>
				{watchedBackend === "directory" && <DirectoryForm form={form} />}
				{watchedBackend === "nfs" && <NFSForm form={form} />}
				{watchedBackend === "webdav" && <WebDAVForm form={form} />}
				{watchedBackend === "smb" && <SMBForm form={form} />}
				{watchedBackend === "rclone" && <RcloneForm form={form} />}
				{watchedBackend === "sftp" && <SFTPForm form={form} />}
				{watchedBackend && watchedBackend !== "directory" && watchedBackend !== "rclone" && (
					<div className="space-y-3">
						<div className="flex items-center gap-2">
							<Button
								type="button"
								variant="outline"
								onClick={handleTestConnection}
								disabled={testBackendConnection.isPending}
								className="flex-1"
							>
								{testBackendConnection.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
								{!testBackendConnection.isPending && testMessage?.success && (
									<CheckCircle className="mr-2 h-4 w-4 text-green-500" />
								)}
								{!testBackendConnection.isPending && testMessage && !testMessage.success && (
									<XCircle className="mr-2 h-4 w-4 text-red-500" />
								)}
								{!testBackendConnection.isPending && !testMessage && <Plug className="mr-2 h-4 w-4" />}
								{testBackendConnection.isPending
									? "Testing..."
									: testMessage
										? testMessage.success
											? "Connection Successful"
											: "Test Failed"
										: "Test Connection"}
							</Button>
						</div>
						{testMessage && (
							<div
								className={cn("text-xs p-2 rounded-md text-wrap wrap-anywhere", {
									"bg-green-50 text-green-700 border border-green-200": testMessage.success,
									"bg-red-50 text-red-700 border border-red-200": !testMessage.success,
								})}
							>
								{testMessage.message}
							</div>
						)}
					</div>
				)}
				{mode === "update" && (
					<Button type="submit" className="w-full" loading={loading}>
						<Save className="h-4 w-4 mr-2" />
						Save changes
					</Button>
				)}
			</form>
		</Form>
	);
};
