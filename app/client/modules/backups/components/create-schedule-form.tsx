import { arktypeResolver } from "@hookform/resolvers/arktype";
import { useQuery } from "@tanstack/react-query";
import { type } from "arktype";
import { useCallback, useState } from "react";
import { useForm } from "react-hook-form";
import { listRepositoriesOptions } from "~/client/api-client/@tanstack/react-query.gen";
import { RepositoryIcon } from "~/client/components/repository-icon";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/client/components/ui/card";
import {
	Form,
	FormControl,
	FormDescription,
	FormField,
	FormItem,
	FormLabel,
	FormMessage,
} from "~/client/components/ui/form";
import { Input } from "~/client/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "~/client/components/ui/select";
import { Textarea } from "~/client/components/ui/textarea";
import { VolumeFileBrowser } from "~/client/components/volume-file-browser";
import type { BackupSchedule, Volume } from "~/client/lib/types";
import { deepClean } from "~/utils/object";

const internalFormSchema = type({
	name: "1 <= string <= 32",
	repositoryId: "string",
	excludePatternsText: "string?",
	includePatterns: "string[]?",
	frequency: "string",
	dailyTime: "string?",
	weeklyDay: "string?",
	keepLast: "number?",
	keepHourly: "number?",
	keepDaily: "number?",
	keepWeekly: "number?",
	keepMonthly: "number?",
	keepYearly: "number?",
});
const cleanSchema = type.pipe((d) => internalFormSchema(deepClean(d)));

export const weeklyDays = [
	{ label: "Monday", value: "1" },
	{ label: "Tuesday", value: "2" },
	{ label: "Wednesday", value: "3" },
	{ label: "Thursday", value: "4" },
	{ label: "Friday", value: "5" },
	{ label: "Saturday", value: "6" },
	{ label: "Sunday", value: "0" },
];

type InternalFormValues = typeof internalFormSchema.infer;

export type BackupScheduleFormValues = Omit<InternalFormValues, "excludePatternsText"> & {
	excludePatterns?: string[];
};

type Props = {
	volume: Volume;
	initialValues?: BackupSchedule;
	onSubmit: (data: BackupScheduleFormValues) => void;
	loading?: boolean;
	summaryContent?: React.ReactNode;
	formId: string;
};

const backupScheduleToFormValues = (schedule?: BackupSchedule): InternalFormValues | undefined => {
	if (!schedule) {
		return undefined;
	}

	const parts = schedule.cronExpression.split(" ");
	const [minutePart, hourPart, , , dayOfWeekPart] = parts;

	const isHourly = hourPart === "*";
	const isDaily = !isHourly && dayOfWeekPart === "*";
	const frequency = isHourly ? "hourly" : isDaily ? "daily" : "weekly";

	const dailyTime = isHourly ? undefined : `${hourPart.padStart(2, "0")}:${minutePart.padStart(2, "0")}`;

	const weeklyDay = frequency === "weekly" ? dayOfWeekPart : undefined;

	return {
		name: schedule.name,
		repositoryId: schedule.repositoryId,
		frequency,
		dailyTime,
		weeklyDay,
		includePatterns: schedule.includePatterns || undefined,
		excludePatternsText: schedule.excludePatterns?.join("\n") || undefined,
		...schedule.retentionPolicy,
	};
};

export const CreateScheduleForm = ({ initialValues, formId, onSubmit, volume }: Props) => {
	const form = useForm<InternalFormValues>({
		resolver: arktypeResolver(cleanSchema as unknown as typeof internalFormSchema),
		defaultValues: backupScheduleToFormValues(initialValues),
	});

	const handleSubmit = useCallback(
		(data: InternalFormValues) => {
			// Convert excludePatternsText string to excludePatterns array
			const { excludePatternsText, ...rest } = data;
			const excludePatterns = excludePatternsText
				? excludePatternsText
						.split("\n")
						.map((p) => p.trim())
						.filter(Boolean)
				: undefined;

			onSubmit({
				...rest,
				excludePatterns,
			});
		},
		[onSubmit],
	);

	const { data: repositoriesData } = useQuery({
		...listRepositoriesOptions(),
	});

	const frequency = form.watch("frequency");
	const formValues = form.watch();

	const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set(initialValues?.includePatterns || []));

	const handleSelectionChange = useCallback(
		(paths: Set<string>) => {
			setSelectedPaths(paths);
			form.setValue("includePatterns", Array.from(paths));
		},
		[form],
	);

	return (
		<Form {...form}>
			<form
				onSubmit={form.handleSubmit(handleSubmit)}
				className="grid gap-4 xl:grid-cols-[minmax(0,2.3fr)_minmax(320px,1fr)]"
				id={formId}
			>
				<div className="grid gap-4">
					<Card>
						<CardHeader>
							<CardTitle>Backup automation</CardTitle>
							<CardDescription className="mt-1">
								Schedule automated backups of <strong>{volume.name}</strong> to a secure repository.
							</CardDescription>
						</CardHeader>
						<CardContent className="grid gap-6 md:grid-cols-2">
							<FormField
								control={form.control}
								name="name"
								render={({ field }) => (
									<FormItem className="md:col-span-2">
										<FormLabel>Backup name</FormLabel>
										<FormControl>
											<Input placeholder="My backup" {...field} />
										</FormControl>
										<FormDescription>A unique name to identify this backup schedule.</FormDescription>
										<FormMessage />
									</FormItem>
								)}
							/>

							<FormField
								control={form.control}
								name="repositoryId"
								render={({ field }) => (
									<FormItem className="md:col-span-2">
										<FormLabel>Backup repository</FormLabel>
										<FormControl>
											<Select {...field} onValueChange={field.onChange}>
												<SelectTrigger>
													<SelectValue placeholder="Select a repository" />
												</SelectTrigger>
												<SelectContent>
													{repositoriesData?.map((repo) => (
														<SelectItem key={repo.id} value={repo.id}>
															<span className="flex items-center gap-2">
																<RepositoryIcon backend={repo.type} />
																{repo.name}
															</span>
														</SelectItem>
													))}
												</SelectContent>
											</Select>
										</FormControl>
										<FormDescription>
											Choose where encrypted backups for <strong>{volume.name}</strong> will be stored.
										</FormDescription>
										<FormMessage />
									</FormItem>
								)}
							/>

							<FormField
								control={form.control}
								name="frequency"
								render={({ field }) => (
									<FormItem>
										<FormLabel>Backup frequency</FormLabel>
										<FormControl>
											<Select {...field} onValueChange={field.onChange}>
												<SelectTrigger>
													<SelectValue placeholder="Select frequency" />
												</SelectTrigger>
												<SelectContent>
													<SelectItem value="hourly">Hourly</SelectItem>
													<SelectItem value="daily">Daily</SelectItem>
													<SelectItem value="weekly">Weekly</SelectItem>
												</SelectContent>
											</Select>
										</FormControl>
										<FormDescription>Define how often snapshots should be taken.</FormDescription>
										<FormMessage />
									</FormItem>
								)}
							/>

							{frequency !== "hourly" && (
								<FormField
									control={form.control}
									name="dailyTime"
									render={({ field }) => (
										<FormItem>
											<FormLabel>Execution time</FormLabel>
											<FormControl>
												<Input type="time" {...field} />
											</FormControl>
											<FormDescription>Time of day when the backup will run.</FormDescription>
											<FormMessage />
										</FormItem>
									)}
								/>
							)}

							{frequency === "weekly" && (
								<FormField
									control={form.control}
									name="weeklyDay"
									render={({ field }) => (
										<FormItem className="md:col-span-2">
											<FormLabel>Execution day</FormLabel>
											<FormControl>
												<Select {...field} onValueChange={field.onChange}>
													<SelectTrigger>
														<SelectValue placeholder="Select a day" />
													</SelectTrigger>
													<SelectContent>
														{weeklyDays.map((day) => (
															<SelectItem key={day.value} value={day.value}>
																{day.label}
															</SelectItem>
														))}
													</SelectContent>
												</Select>
											</FormControl>
											<FormDescription>Choose which day of the week to run the backup.</FormDescription>
											<FormMessage />
										</FormItem>
									)}
								/>
							)}
						</CardContent>
					</Card>

					<Card>
						<CardHeader>
							<CardTitle>Backup paths</CardTitle>
							<CardDescription>
								Select which folders or files to include in the backup. If no paths are selected, the entire volume will
								be backed up.
							</CardDescription>
						</CardHeader>
						<CardContent>
							<VolumeFileBrowser
								volumeName={volume.name}
								selectedPaths={selectedPaths}
								onSelectionChange={handleSelectionChange}
								withCheckboxes={true}
								foldersOnly={false}
								className="flex-1 border rounded-md bg-card p-2 min-h-[300px] max-h-[400px] overflow-auto"
							/>
							{selectedPaths.size > 0 && (
								<div className="mt-4">
									<p className="text-xs text-muted-foreground mb-2">Selected paths:</p>
									<div className="flex flex-wrap gap-2">
										{Array.from(selectedPaths).map((path) => (
											<span key={path} className="text-xs bg-accent px-2 py-1 rounded-md font-mono">
												{path}
											</span>
										))}
									</div>
								</div>
							)}
						</CardContent>
					</Card>

					<Card>
						<CardHeader>
							<CardTitle>Exclude patterns</CardTitle>
							<CardDescription>
								Optionally specify patterns to exclude from backups. Enter one pattern per line (e.g., *.tmp,
								node_modules/**, .cache/).
							</CardDescription>
						</CardHeader>
						<CardContent>
							<FormField
								control={form.control}
								name="excludePatternsText"
								render={({ field }) => (
									<FormItem>
										<FormLabel>Exclusion patterns</FormLabel>
										<FormControl>
											<Textarea
												{...field}
												placeholder="*.tmp&#10;node_modules/**&#10;.cache/&#10;*.log"
												className="font-mono text-sm min-h-[120px]"
											/>
										</FormControl>
										<FormDescription>
											Patterns support glob syntax. See&nbsp;
											<a
												href="https://restic.readthedocs.io/en/stable/040_backup.html#excluding-files"
												target="_blank"
												rel="noopener noreferrer"
												className="underline hover:text-foreground"
											>
												Restic documentation
											</a>
											&nbsp;for more details.
										</FormDescription>
										<FormMessage />
									</FormItem>
								)}
							/>
						</CardContent>
					</Card>

					<Card>
						<CardHeader>
							<CardTitle>Retention policy</CardTitle>
							<CardDescription>Define how many snapshots to keep. Leave empty to keep all.</CardDescription>
						</CardHeader>
						<CardContent className="grid gap-4 md:grid-cols-2">
							<FormField
								control={form.control}
								name="keepLast"
								render={({ field }) => (
									<FormItem>
										<FormLabel>Keep last N snapshots</FormLabel>
										<FormControl>
											<Input
												{...field}
												type="number"
												min={0}
												placeholder="Optional"
												onChange={(v) => field.onChange(Number(v.target.value))}
											/>
										</FormControl>
										<FormDescription>Keep the N most recent snapshots.</FormDescription>
										<FormMessage />
									</FormItem>
								)}
							/>

							<FormField
								control={form.control}
								name="keepHourly"
								render={({ field }) => (
									<FormItem>
										<FormLabel>Keep hourly</FormLabel>
										<FormControl>
											<Input
												type="number"
												min={0}
												placeholder="Optional"
												{...field}
												onChange={(v) => field.onChange(Number(v.target.value))}
											/>
										</FormControl>
										<FormDescription>Keep the last N hourly snapshots.</FormDescription>
										<FormMessage />
									</FormItem>
								)}
							/>

							<FormField
								control={form.control}
								name="keepDaily"
								render={({ field }) => (
									<FormItem>
										<FormLabel>Keep daily</FormLabel>
										<FormControl>
											<Input
												type="number"
												min={0}
												placeholder="e.g., 7"
												{...field}
												onChange={(v) => field.onChange(Number(v.target.value))}
											/>
										</FormControl>
										<FormDescription>Keep the last N daily snapshots.</FormDescription>
										<FormMessage />
									</FormItem>
								)}
							/>

							<FormField
								control={form.control}
								name="keepWeekly"
								render={({ field }) => (
									<FormItem>
										<FormLabel>Keep weekly</FormLabel>
										<FormControl>
											<Input
												type="number"
												min={0}
												placeholder="e.g., 4"
												{...field}
												onChange={(v) => field.onChange(Number(v.target.value))}
											/>
										</FormControl>
										<FormDescription>Keep the last N weekly snapshots.</FormDescription>
										<FormMessage />
									</FormItem>
								)}
							/>

							<FormField
								control={form.control}
								name="keepMonthly"
								render={({ field }) => (
									<FormItem>
										<FormLabel>Keep monthly</FormLabel>
										<FormControl>
											<Input
												type="number"
												min={0}
												placeholder="e.g., 6"
												{...field}
												onChange={(v) => field.onChange(Number(v.target.value))}
											/>
										</FormControl>
										<FormDescription>Keep the last N monthly snapshots.</FormDescription>
										<FormMessage />
									</FormItem>
								)}
							/>

							<FormField
								control={form.control}
								name="keepYearly"
								render={({ field }) => (
									<FormItem>
										<FormLabel>Keep yearly</FormLabel>
										<FormControl>
											<Input
												type="number"
												min={0}
												placeholder="Optional"
												{...field}
												onChange={(v) => field.onChange(Number(v.target.value))}
											/>
										</FormControl>
										<FormDescription>Keep the last N yearly snapshots.</FormDescription>
										<FormMessage />
									</FormItem>
								)}
							/>
						</CardContent>
					</Card>
				</div>
				<div className="h-full">
					<Card className="h-full">
						<CardHeader className="flex flex-row items-center justify-between gap-4">
							<div>
								<CardTitle>Schedule summary</CardTitle>
								<CardDescription>Review the backup configuration.</CardDescription>
							</div>
						</CardHeader>
						<CardContent className="flex flex-col gap-4 text-sm">
							<div>
								<p className="text-xs uppercase text-muted-foreground">Volume</p>
								<p className="font-medium">{volume.name}</p>
							</div>
							<div>
								<p className="text-xs uppercase text-muted-foreground">Schedule</p>
								<p className="font-medium">
									{frequency ? frequency.charAt(0).toUpperCase() + frequency.slice(1) : "-"}
								</p>
							</div>
							<div>
								<p className="text-xs uppercase text-muted-foreground">Repository</p>
								<p className="font-medium">
									{repositoriesData?.find((r) => r.id === formValues.repositoryId)?.name || "—"}
								</p>
							</div>
							{formValues.includePatterns && formValues.includePatterns.length > 0 && (
								<div>
									<p className="text-xs uppercase text-muted-foreground">Include paths</p>
									<div className="flex flex-col gap-1">
										{formValues.includePatterns.map((path) => (
											<span key={path} className="text-xs font-mono bg-accent px-1.5 py-0.5 rounded">
												{path}
											</span>
										))}
									</div>
								</div>
							)}
							{formValues.excludePatternsText && (
								<div>
									<p className="text-xs uppercase text-muted-foreground">Exclude patterns</p>
									<div className="flex flex-col gap-1">
										{formValues.excludePatternsText
											.split("\n")
											.filter(Boolean)
											.map((pattern) => (
												<span key={pattern} className="text-xs font-mono bg-accent px-1.5 py-0.5 rounded">
													{pattern.trim()}
												</span>
											))}
									</div>
								</div>
							)}
							<div>
								<p className="text-xs uppercase text-muted-foreground">Retention</p>
								<p className="font-medium">
									{Object.entries(formValues)
										.filter(([key, value]) => key.startsWith("keep") && Boolean(value))
										.map(([key, value]) => {
											const label = key.replace("keep", "").toLowerCase();
											return `${value} ${label}`;
										})
										.join(", ") || "-"}
								</p>
							</div>
						</CardContent>
					</Card>
				</div>
			</form>
		</Form>
	);
};
