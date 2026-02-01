import { arktypeResolver } from "@hookform/resolvers/arktype";
import { useCallback, useState } from "react";
import { useForm } from "react-hook-form";
import { Form } from "~/client/components/ui/form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/client/components/ui/card";
import type { BackupSchedule, Volume } from "~/client/lib/types";
import { BasicInfoSection } from "./basic-info-section";
import { ExcludeSection } from "./exclude-section";
import { FrequencySection } from "./frequency-section";
import { PathsSection } from "./paths-section";
import { RetentionSection } from "./retention-section";
import { SummarySection } from "./summary-section";
import { cleanSchema, type BackupScheduleFormValues, type InternalFormValues } from "./types";
import { backupScheduleToFormValues } from "./utils";

export type { BackupScheduleFormValues };

type Props = {
	volume: Volume;
	initialValues?: BackupSchedule;
	onSubmit: (data: BackupScheduleFormValues) => void;
	loading?: boolean;
	summaryContent?: React.ReactNode;
	formId: string;
};

export const CreateScheduleForm = ({ initialValues, formId, onSubmit, volume }: Props) => {
	const form = useForm<InternalFormValues>({
		resolver: arktypeResolver(cleanSchema as unknown as typeof import("./types").internalFormSchema),
		defaultValues: backupScheduleToFormValues(initialValues),
	});

	const handleSubmit = useCallback(
		(data: InternalFormValues) => {
			const {
				excludePatternsText,
				excludeIfPresentText,
				includePatternsText,
				includePatterns: fileBrowserPatterns,
				cronExpression,
				...rest
			} = data;
			const excludePatterns = excludePatternsText
				? excludePatternsText
						.split("\n")
						.map((p) => p.trim())
						.filter(Boolean)
				: [];

			const excludeIfPresent = excludeIfPresentText
				? excludeIfPresentText
						.split("\n")
						.map((p) => p.trim())
						.filter(Boolean)
				: [];

			const textPatterns = includePatternsText
				? includePatternsText
						.split("\n")
						.map((p) => p.trim())
						.filter(Boolean)
				: [];
			const includePatterns = [...(fileBrowserPatterns || []), ...textPatterns];

			onSubmit({
				...rest,
				cronExpression,
				includePatterns: includePatterns.length > 0 ? includePatterns : [],
				excludePatterns,
				excludeIfPresent,
			});
		},
		[onSubmit],
	);

	const frequency = form.watch("frequency");
	const formValues = form.watch();

	const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set(initialValues?.includePatterns || []));
	const [showAllSelectedPaths, setShowAllSelectedPaths] = useState(false);

	const handleSelectionChange = useCallback(
		(paths: Set<string>) => {
			setSelectedPaths(paths);
			form.setValue("includePatterns", Array.from(paths));
		},
		[form],
	);

	const handleRemovePath = useCallback(
		(pathToRemove: string) => {
			const newPaths = new Set(selectedPaths);
			newPaths.delete(pathToRemove);
			setSelectedPaths(newPaths);
			form.setValue("includePatterns", Array.from(newPaths));
		},
		[selectedPaths, form],
	);

	return (
		<Form {...form}>
			<form
				onSubmit={form.handleSubmit(handleSubmit)}
				className="grid gap-4 xl:grid-cols-[minmax(0,2.3fr)_minmax(320px,1fr)]"
				id={formId}
			>
				<div className="grid gap-4 min-w-0">
					<Card className="min-w-0">
						<CardHeader>
							<CardTitle>Backup automation</CardTitle>
							<CardDescription className="mt-1">
								Schedule automated backups of <strong>{volume.name}</strong> to a secure repository.
							</CardDescription>
						</CardHeader>
						<CardContent className="grid gap-6 @md:grid-cols-2">
							<BasicInfoSection form={form} volume={volume} />
							<FrequencySection form={form} frequency={frequency} />
						</CardContent>
					</Card>

					<Card className="min-w-0">
						<CardHeader>
							<CardTitle>Backup paths</CardTitle>
							<CardDescription>
								Select which folders or files to include in the backup. If no paths are selected, the entire volume will
								be backed up.
							</CardDescription>
						</CardHeader>
						<CardContent>
							<PathsSection
								form={form}
								volume={volume}
								selectedPaths={selectedPaths}
								onSelectionChange={handleSelectionChange}
								onRemovePath={handleRemovePath}
								showAllSelectedPaths={showAllSelectedPaths}
								onToggleShowAllPaths={() => setShowAllSelectedPaths(!showAllSelectedPaths)}
							/>
						</CardContent>
					</Card>

					<Card className="min-w-0">
						<CardHeader>
							<CardTitle>Exclude patterns</CardTitle>
							<CardDescription>
								Optionally specify patterns to exclude from backups. Enter one pattern per line (e.g., *.tmp,
								node_modules/**, .cache/).
							</CardDescription>
						</CardHeader>
						<CardContent>
							<ExcludeSection form={form} />
						</CardContent>
					</Card>

					<Card className="min-w-0">
						<CardHeader>
							<CardTitle>Retention policy</CardTitle>
							<CardDescription>Define how many snapshots to keep. Leave empty to keep all.</CardDescription>
						</CardHeader>
						<CardContent className="grid gap-4 @md:grid-cols-2">
							<RetentionSection form={form} />
						</CardContent>
					</Card>
				</div>
				<div className="xl:sticky xl:top-6 xl:self-start">
					<SummarySection volume={volume} frequency={frequency} formValues={formValues} />
				</div>
			</form>
		</Form>
	);
};
