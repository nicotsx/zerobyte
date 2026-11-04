import type { UseFormReturn } from "react-hook-form";
import { useWatch } from "react-hook-form";
import { AlertTriangle } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import {
	FormItem,
	FormLabel,
	FormDescription,
	FormField,
	FormControl,
	FormMessage,
} from "../../../../components/ui/form";
import { Input } from "../../../../components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../../../components/ui/select";
import type { RepositoryFormValues } from "../create-repository-form";
import { useServerFn } from "@tanstack/react-start";
import { getServerConstants } from "~/server/lib/functions/server-constants";
import { useSuspenseQuery } from "@tanstack/react-query";
import { listSourceMachinesOptions } from "~/client/api-client/@tanstack/react-query.gen";
import { FolderSelector } from "~/client/components/folder-selector";
import { getMachineStatus, isMachineAvailable, machineStatusLabels } from "~/client/lib/machine-status";
import { TrustedRootBrowser } from "~/client/modules/volumes/components/trusted-root-browser";

type Props = {
	form: UseFormReturn<RepositoryFormValues>;
	exactPath: boolean;
	mode: "create" | "update";
	/** The repository is (or will be) stored on a remote machine rather than this server. */
	onAnotherMachine: boolean;
	agentName?: string | null;
};

/** Repositories on another machine store a path relative to the chosen location; "." is the location itself. */
const toBrowserValue = (path: string | undefined) => (path ? (path === "." ? "" : path) : null);

export const LocalRepositoryForm = ({ form, exactPath, mode, onAnotherMachine, agentName }: Props) => {
	const getConstants = useServerFn(getServerConstants);
	const { data: constants } = useSuspenseQuery({
		queryKey: ["server-constants"],
		queryFn: getConstants,
	});

	const [agentId, trustedRootId] = useWatch({ control: form.control, name: ["agentId", "trustedRootId"] });

	const machinesQuery = useQuery({ ...listSourceMachinesOptions(), enabled: onAnotherMachine });
	const machines = machinesQuery.data ?? [];
	const machine = machines.find((candidate) => candidate.id === agentId);
	const machineLabel = mode === "update" ? agentName : machine?.name;
	const machineIsOnline = machine !== undefined && isMachineAvailable(machine);
	const root = machine?.trustedRoots.find((candidate) => candidate.id === trustedRootId);
	const hasRepositoryLocation = machine?.trustedRoots.some((candidate) => candidate.canStoreRepository) === true;

	return (
		<>
			{mode === "create" && onAnotherMachine && (
				<FormField
					control={form.control}
					name="agentId"
					render={({ field }) => (
						<FormItem>
							<FormLabel>Machine</FormLabel>
							<Select
								value={field.value ?? ""}
								onValueChange={(value) => {
									field.onChange(value);
									form.setValue("trustedRootId", undefined);
									form.setValue("path", "");
								}}
							>
								<FormControl>
									<SelectTrigger className="w-full">
										<SelectValue placeholder="Choose a machine" />
									</SelectTrigger>
								</FormControl>
								<SelectContent>
									{machines.map((candidate) => (
										<SelectItem
											key={candidate.id}
											value={candidate.id}
											disabled={!isMachineAvailable(candidate)}
										>
											{candidate.name} · {machineStatusLabels[getMachineStatus(candidate)]}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
							<FormDescription>
								The repository is written by this machine and only accepts backups from sources on it.
							</FormDescription>
							<FormMessage />
						</FormItem>
					)}
				/>
			)}

			{mode === "create" && onAnotherMachine && machinesQuery.isSuccess && machines.length === 0 && (
				<p className="text-sm text-muted-foreground">No machines are connected yet.</p>
			)}

			{mode === "update" && (
				<FormItem>
					<FormLabel>Machine</FormLabel>
					<Input value={agentName ?? "This server"} disabled readOnly />
					<FormDescription>The machine that stores this repository cannot be changed.</FormDescription>
				</FormItem>
			)}

			{onAnotherMachine && machine && !hasRepositoryLocation && (
				<p className="text-sm text-muted-foreground">
					No location on {machineLabel ?? "this machine"} allows repositories. Add{" "}
					<code>"allowRepository": true</code> to a root in <code>ZEROBYTE_AGENT_ROOTS</code> on the machine,
					then restart its agent.
				</p>
			)}

			{onAnotherMachine && machine && hasRepositoryLocation && (
				<FormField
					control={form.control}
					name="trustedRootId"
					render={({ field }) => (
						<FormItem>
							<FormLabel>Location</FormLabel>
							<Select
								value={field.value ?? ""}
								disabled={!machineIsOnline}
								onValueChange={(value) => {
									field.onChange(value);
									form.setValue("path", "");
								}}
							>
								<FormControl>
									<SelectTrigger className="w-full">
										<SelectValue placeholder="Choose a location" />
									</SelectTrigger>
								</FormControl>
								<SelectContent>
									{machine.trustedRoots.map((candidate) => (
										<SelectItem
											key={candidate.id}
											value={candidate.id}
											disabled={!candidate.canStoreRepository}
										>
											{candidate.label}
											{!candidate.canStoreRepository && " · Repositories disabled"}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
							<FormDescription>
								Locations on {machineLabel ?? "the machine"} that allow repositories (
								<code>"allowRepository": true</code> in its <code>ZEROBYTE_AGENT_ROOTS</code>).
							</FormDescription>
							<FormMessage />
						</FormItem>
					)}
				/>
			)}

			<FormField
				control={form.control}
				name="path"
				render={({ field }) => (
					<FormItem>
						<FormLabel>Repository Directory</FormLabel>
						{onAnotherMachine && machine && root ? (
							<TrustedRootBrowser
								key={`${machine.id}:${root.id}`}
								agentId={machine.id}
								rootId={root.id}
								rootLabel={root.label}
								value={toBrowserValue(field.value)}
								disabled={!machineIsOnline}
								onChange={(relativePath) => field.onChange(relativePath || ".")}
							/>
						) : onAnotherMachine ? (
							<div className="text-sm font-mono bg-muted px-3 py-2 rounded-md border text-muted-foreground">
								Choose a machine and location first
							</div>
						) : (
							<FormControl>
								<FolderSelector
									value={field.value || constants.REPOSITORY_BASE}
									onChange={field.onChange}
									displayValue={
										<>
											{field.value || constants.REPOSITORY_BASE}
											{!exactPath && (
												<span className="text-muted-foreground">/{"{unique-id}"}</span>
											)}
										</>
									}
									webBrowser={{
										mode: "dialog",
										title: "Select Repository Directory",
										description: "Choose a directory from the filesystem to store the repository.",
										warning: {
											title: (
												<>
													<AlertTriangle className="h-5 w-5 text-yellow-500" />
													Important: Host mount required
												</>
											),
											description: (
												<>
													<div>
														When selecting a custom path, ensure it is mounted from the host
														machine into the container.
													</div>
													<div className="font-medium">
														If the path is not a host mount, you will lose your repository
														data when the container restarts.
													</div>
													<div className="text-sm text-muted-foreground">
														The default path{" "}
														<code className="bg-muted px-1 rounded">
															{constants.REPOSITORY_BASE}
														</code>{" "}
														is safe to use if you followed the recommended Docker Compose
														setup.
													</div>
												</>
											),
											continueLabel: "I Understand, Continue",
										},
									}}
								/>
							</FormControl>
						)}
						<FormDescription>
							{exactPath
								? "The exact path to your existing repository."
								: "A unique subdirectory will be created inside this directory to store the repository."}
						</FormDescription>
						<FormMessage />
					</FormItem>
				)}
			/>
		</>
	);
};
