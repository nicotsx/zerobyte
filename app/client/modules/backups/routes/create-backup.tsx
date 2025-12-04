import { useId, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Database, HardDrive } from "lucide-react";
import { Link, useNavigate } from "react-router";
import { toast } from "sonner";
import {
	createBackupScheduleMutation,
	listRepositoriesOptions,
	listVolumesOptions,
} from "~/client/api-client/@tanstack/react-query.gen";
import { Button } from "~/client/components/ui/button";
import { Card, CardContent } from "~/client/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "~/client/components/ui/select";
import { parseError } from "~/client/lib/errors";
import { EmptyState } from "~/client/components/empty-state";
import { getCronExpression } from "~/utils/utils";
import { CreateScheduleForm, type BackupScheduleFormValues } from "../components/create-schedule-form";
import type { Route } from "./+types/create-backup";
import { listRepositories, listVolumes } from "~/client/api-client";

export const handle = {
	breadcrumb: () => [{ label: "Backups", href: "/backups" }, { label: "Create" }],
};

export function meta(_: Route.MetaArgs) {
	return [
		{ title: "Zerobyte - Create Backup Job" },
		{
			name: "description",
			content: "Create a new automated backup job for your volumes.",
		},
	];
}

export const clientLoader = async () => {
	const volumes = await listVolumes();
	const repositories = await listRepositories();

	if (volumes.data && repositories.data) return { volumes: volumes.data, repositories: repositories.data };
	return { volumes: [], repositories: [] };
};

export default function CreateBackup({ loaderData }: Route.ComponentProps) {
	const navigate = useNavigate();
	const formId = useId();
	const [selectedVolumeId, setSelectedVolumeId] = useState<number | undefined>();

	const { data: volumesData, isLoading: loadingVolumes } = useQuery({
		...listVolumesOptions(),
		initialData: loaderData.volumes,
	});

	const { data: repositoriesData } = useQuery({
		...listRepositoriesOptions(),
		initialData: loaderData.repositories,
	});

	const createSchedule = useMutation({
		...createBackupScheduleMutation(),
		onSuccess: (data) => {
			toast.success("Backup job created successfully");
			navigate(`/backups/${data.id}`);
		},
		onError: (error) => {
			toast.error("Failed to create backup job", {
				description: parseError(error)?.message,
			});
		},
	});

	const handleSubmit = (formValues: BackupScheduleFormValues) => {
		if (!selectedVolumeId) return;

		const cronExpression = getCronExpression(formValues.frequency, formValues.dailyTime, formValues.weeklyDay);

		const retentionPolicy: Record<string, number> = {};
		if (formValues.keepLast) retentionPolicy.keepLast = formValues.keepLast;
		if (formValues.keepHourly) retentionPolicy.keepHourly = formValues.keepHourly;
		if (formValues.keepDaily) retentionPolicy.keepDaily = formValues.keepDaily;
		if (formValues.keepWeekly) retentionPolicy.keepWeekly = formValues.keepWeekly;
		if (formValues.keepMonthly) retentionPolicy.keepMonthly = formValues.keepMonthly;
		if (formValues.keepYearly) retentionPolicy.keepYearly = formValues.keepYearly;

		createSchedule.mutate({
			body: {
				name: formValues.name,
				volumeId: selectedVolumeId,
				repositoryId: formValues.repositoryId,
				enabled: true,
				cronExpression,
				retentionPolicy: Object.keys(retentionPolicy).length > 0 ? retentionPolicy : undefined,
				includePatterns: formValues.includePatterns,
				excludePatterns: formValues.excludePatterns,
			},
		});
	};

	const selectedVolume = volumesData.find((v) => v.id === selectedVolumeId);

	if (loadingVolumes) {
		return (
			<div className="flex items-center justify-center h-full">
				<p className="text-muted-foreground">Loading...</p>
			</div>
		);
	}

	if (!volumesData.length) {
		return (
			<EmptyState
				icon={HardDrive}
				title="No volume to backup"
				description="To create a backup job, you need to create a volume first. Volumes are the data sources that will be backed up."
				button={
					<Button>
						<Link to="/volumes">Go to volumes</Link>
					</Button>
				}
			/>
		);
	}

	if (!repositoriesData?.length) {
		return (
			<EmptyState
				icon={Database}
				title="No repository"
				description="To create a backup job, you need to set up a backup repository first. Backup repositories are the destinations where your backups will be stored."
				button={
					<Button>
						<Link to="/repositories">Go to repositories</Link>
					</Button>
				}
			/>
		);
	}

	return (
		<div className="container mx-auto space-y-6">
			<Card>
				<CardContent>
					<Select value={selectedVolumeId?.toString()} onValueChange={(v) => setSelectedVolumeId(Number(v))}>
						<SelectTrigger id="volume-select">
							<SelectValue placeholder="Choose a volume to backup" />
						</SelectTrigger>
						<SelectContent>
							{volumesData.map((volume) => (
								<SelectItem key={volume.id} value={volume.id.toString()}>
									<span className="flex items-center gap-2">
										<HardDrive className="h-4 w-4" />
										{volume.name}
									</span>
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</CardContent>
			</Card>
			{selectedVolume ? (
				<>
					<CreateScheduleForm volume={selectedVolume} onSubmit={handleSubmit} formId={formId} />
					<div className="flex justify-end mt-4 gap-2">
						<Button type="submit" variant="primary" form={formId} loading={createSchedule.isPending}>
							Create
						</Button>
					</div>
				</>
			) : (
				<Card>
					<CardContent className="py-16">
						<div className="flex flex-col items-center justify-center text-center">
							<div className="relative mb-6">
								<div className="absolute inset-0 animate-pulse">
									<div className="w-24 h-24 rounded-full bg-primary/10 blur-2xl" />
								</div>
								<div className="relative flex items-center justify-center w-24 h-24 rounded-full bg-linear-to-br from-primary/20 to-primary/5 border-2 border-primary/20">
									<Database className="w-12 h-12 text-primary/70" strokeWidth={1.5} />
								</div>
							</div>
							<h3 className="text-xl font-semibold mb-2">Select a volume</h3>
							<p className="text-muted-foreground text-sm max-w-md">
								Choose a volume from the dropdown above to configure its backup schedule.
							</p>
						</div>
					</CardContent>
				</Card>
			)}
		</div>
	);
}
