import { zodResolver } from "@hookform/resolvers/zod";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useForm, useWatch } from "react-hook-form";
import { z } from "zod";
import { listSourceMachinesOptions } from "~/client/api-client/@tanstack/react-query.gen";
import { Alert, AlertAction, AlertContent, AlertDescription } from "~/client/components/ui/alert";
import { Button } from "~/client/components/ui/button";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "~/client/components/ui/form";
import { Input } from "~/client/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "~/client/components/ui/select";
import { useScrollToFormError } from "~/client/hooks/use-scroll-to-form-error";
import { getMachineStatus, isMachineAvailable, machineStatusLabels } from "~/client/lib/machine-status";
import { cn } from "~/client/lib/utils";
import { TrustedRootBrowser } from "./trusted-root-browser";

const filesystemSourceSchema = z.object({
	name: z.string().trim().min(2).max(32),
	agentId: z.string().min(1, "Choose a machine"),
	trustedRootId: z.string().min(1, "Choose an allowed location"),
	relativePath: z
		.string()
		.nullable()
		.pipe(z.string({ error: "Choose the entire location or a folder" })),
});

export type FilesystemSourceValues = z.output<typeof filesystemSourceSchema>;

type Props = {
	formId: string;
	initialValues?: FilesystemSourceValues;
	onSubmit: (values: FilesystemSourceValues) => void;
};

export const AgentFilesystemSourceForm = ({ formId, initialValues, onSubmit }: Props) => {
	const form = useForm<z.input<typeof filesystemSourceSchema>, unknown, FilesystemSourceValues>({
		resolver: zodResolver(filesystemSourceSchema),
		defaultValues: initialValues ?? { name: "", agentId: "", trustedRootId: "", relativePath: null },
	});
	const scrollToFirstError = useScrollToFormError();

	const machinesQuery = useQuery(listSourceMachinesOptions());

	const [agentId, trustedRootId] = useWatch({ control: form.control, name: ["agentId", "trustedRootId"] });
	const machines = machinesQuery.data ?? [];
	const machine = machines.find((item) => item.id === agentId);
	const root = machine?.trustedRoots.find((item) => item.id === trustedRootId);
	const machineIsOnline = machine !== undefined && isMachineAvailable(machine);

	return (
		<Form {...form}>
			<form id={formId} onSubmit={form.handleSubmit(onSubmit, scrollToFirstError)} className="space-y-4">
				<FormField
					control={form.control}
					name="name"
					render={({ field }) => (
						<FormItem>
							<FormLabel>Name</FormLabel>
							<FormControl>
								<Input {...field} placeholder="Source name" maxLength={32} />
							</FormControl>
							<FormMessage />
						</FormItem>
					)}
				/>

				{machinesQuery.isError && (
					<Alert variant="destructive">
						<AlertContent>
							<AlertDescription>Machines could not be loaded.</AlertDescription>
						</AlertContent>
						<AlertAction>
							<Button
								type="button"
								variant="outline"
								size="sm"
								onClick={() => void machinesQuery.refetch()}
							>
								Retry
							</Button>
						</AlertAction>
					</Alert>
				)}
				{machinesQuery.isPending && <p className="text-sm text-muted-foreground">Loading machines…</p>}

				{machinesQuery.isSuccess && (
					<>
						<FormField
							control={form.control}
							name="agentId"
							render={({ field }) => (
								<FormItem>
									<FormLabel>Machine</FormLabel>
									<Select
										value={field.value}
										onValueChange={(value) => {
											field.onChange(value);
											form.setValue("trustedRootId", "");
											form.setValue("relativePath", null);
										}}
									>
										<FormControl>
											<SelectTrigger className="w-full">
												<SelectValue placeholder="Choose a machine" />
											</SelectTrigger>
										</FormControl>
										<SelectContent>
											{machines.map((item) => (
												<SelectItem
													key={item.id}
													value={item.id}
													disabled={!isMachineAvailable(item)}
												>
													{item.name} · {machineStatusLabels[getMachineStatus(item)]}
												</SelectItem>
											))}
										</SelectContent>
									</Select>
									<FormMessage />
								</FormItem>
							)}
						/>

						{(machines.length === 0 || machine?.trustedRoots.length === 0) && (
							<p className="text-sm text-muted-foreground">
								<span className={cn({ hidden: machines.length > 0 })}>
									No machines are connected yet.
								</span>
								<span className={cn({ hidden: machines.length === 0 })}>
									This machine does not share any folder yet. On {machine?.name}, run{" "}
									<code>sudo zerobyte-agent folders add</code> to choose folders.
								</span>{" "}
								<Link
									to="/settings"
									search={{ scope: "organization" }}
									hash="machines"
									className="underline underline-offset-4"
								>
									Manage machines
								</Link>
							</p>
						)}

						{machine && machine.trustedRoots.length > 0 && (
							<FormField
								control={form.control}
								name="trustedRootId"
								render={({ field }) => (
									<FormItem>
										<FormLabel>Allowed location</FormLabel>
										<Select
											value={field.value}
											disabled={!machineIsOnline}
											onValueChange={(value) => {
												field.onChange(value);
												form.setValue("relativePath", null);
											}}
										>
											<FormControl>
												<SelectTrigger className="w-full">
													<SelectValue placeholder="Choose an allowed location" />
												</SelectTrigger>
											</FormControl>
											<SelectContent>
												{machine.trustedRoots.map((item) => (
													<SelectItem
														key={item.id}
														value={item.id}
														disabled={!item.canBackup}
													>
														{item.label}
														{!item.canBackup && " · Backups disabled"}
													</SelectItem>
												))}
											</SelectContent>
										</Select>
										<FormMessage />
									</FormItem>
								)}
							/>
						)}

						{root && (
							<FormField
								control={form.control}
								name="relativePath"
								render={({ field }) => (
									<FormItem>
										<FormLabel>Folder</FormLabel>
										<TrustedRootBrowser
											key={`${agentId}:${trustedRootId}`}
											agentId={agentId}
											rootId={trustedRootId}
											rootLabel={root.label}
											value={field.value}
											disabled={!machineIsOnline}
											onChange={field.onChange}
										/>
										<FormMessage />
									</FormItem>
								)}
							/>
						)}
					</>
				)}

				<p className="text-xs text-muted-foreground">
					Only folders shared by the machine can be selected. Network shares must already be mounted there.
					{initialValues &&
						" Existing backup schedules follow a location change, so review their selections after saving."}
				</p>
			</form>
		</Form>
	);
};
