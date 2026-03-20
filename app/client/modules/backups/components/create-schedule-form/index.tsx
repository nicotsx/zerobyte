import { zodResolver } from "@hookform/resolvers/zod";
import { useCallback, useState } from "react";
import { useForm } from "react-hook-form";
import { useScrollToFormError } from "~/client/hooks/use-scroll-to-form-error";
import { Form } from "~/client/components/ui/form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/client/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "~/client/components/ui/collapsible";
import type { BackupSchedule, Volume } from "~/client/lib/types";
import { AdvancedSection } from "./advanced-section";
import { BasicInfoSection } from "./basic-info-section";
import { ExcludeSection } from "./exclude-section";
import { FrequencySection } from "./frequency-section";
import { PathsSection } from "./paths-section";
import { RetentionSection } from "./retention-section";
import { SummarySection } from "./summary-section";
import { internalFormSchema, type BackupScheduleFormValues, type InternalFormValues } from "./types";
import { backupScheduleToFormValues, parseMultilineEntries } from "./utils";

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
		resolver: zodResolver(internalFormSchema),
		defaultValues: backupScheduleToFormValues(initialValues),
	});

	const scrollToFirstError = useScrollToFormError();

	const handleSubmit = useCallback(
		(data: InternalFormValues) => {
			const {
				excludePatternsText,
				excludeIfPresentText,
				includePatterns,
				customResticParamsText,
				includePaths,
				cronExpression,
				...rest
			} = data;
			const excludePatterns = parseMultilineEntries(excludePatternsText);
			const excludeIfPresent = parseMultilineEntries(excludeIfPresentText);
			const parsedIncludePatterns = parseMultilineEntries(includePatterns);
			const customResticParams = parseMultilineEntries(customResticParamsText);

			onSubmit({
				...rest,
				cronExpression,
				includePaths: includePaths?.length ? includePaths : [],
				includePatterns: parsedIncludePatterns.length > 0 ? parsedIncludePatterns : [],
				excludePatterns,
				excludeIfPresent,
				customResticParams,
			});
		},
		[onSubmit],
	);

	const frequency = form.watch("frequency");
	const formValues = form.watch();

	const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set(initialValues?.includePaths || []));
	const [showAllSelectedPaths, setShowAllSelectedPaths] = useState(false);

	const handleSelectionChange = useCallback(
		(paths: Set<string>) => {
			setSelectedPaths(paths);
			form.setValue("includePaths", Array.from(paths));
		},
		[form],
	);

	const handleRemovePath = useCallback(
		(pathToRemove: string) => {
			const newPaths = new Set(selectedPaths);
			newPaths.delete(pathToRemove);
			setSelectedPaths(newPaths);
			form.setValue("includePaths", Array.from(newPaths));
		},
		[selectedPaths, form],
	);

	return (
		<Form {...form}>
			<form
				onSubmit={form.handleSubmit(handleSubmit, scrollToFirstError)}
				className="grid gap-4 xl:grid-cols-[minmax(0,2.3fr)_minmax(320px,1fr)]"
				id={formId}
			>
				<div className="grid gap-4 min-w-0">
					<Card className="min-w-0 @container">
						<CardHeader>
							<CardTitle>Backup automation</CardTitle>
							<CardDescription className="mt-1">
								Schedule automated backups of <strong>{volume.name}</strong> to a secure repository.
							</CardDescription>
						</CardHeader>
						<CardContent className="grid gap-6 @medium:grid-cols-2">
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

					<Card className="min-w-0 @container">
						<CardHeader>
							<CardTitle>Retention policy</CardTitle>
							<CardDescription>Define how many snapshots to keep. Leave empty to keep all.</CardDescription>
						</CardHeader>
						<CardContent className="grid gap-4 @medium:grid-cols-2">
							<RetentionSection form={form} />
						</CardContent>
					</Card>

					<Card className="min-w-0 @container">
						<CardContent>
							<Collapsible>
								<CollapsibleTrigger>Advanced</CollapsibleTrigger>
								<CollapsibleContent className="pb-4 space-y-4">
									<AdvancedSection form={form} />
								</CollapsibleContent>
							</Collapsible>
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
