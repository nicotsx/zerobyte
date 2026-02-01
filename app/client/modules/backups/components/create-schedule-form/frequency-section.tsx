import { CronInput } from "~/client/components/cron-input";
import { FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "~/client/components/ui/form";
import { Input } from "~/client/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "~/client/components/ui/select";
import { Button } from "~/client/components/ui/button";
import type { UseFormReturn } from "react-hook-form";
import type { InternalFormValues } from "./types";
import { weeklyDays } from "./types";

type FrequencySectionProps = {
	form: UseFormReturn<InternalFormValues>;
	frequency: string;
};

export const FrequencySection = ({ form, frequency }: FrequencySectionProps) => {
	return (
		<>
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
									<SelectItem value="monthly">Specific days</SelectItem>
									<SelectItem value="cron">Custom (Cron)</SelectItem>
								</SelectContent>
							</Select>
						</FormControl>
						<FormDescription>Define how often snapshots should be taken.</FormDescription>
						<FormMessage />
					</FormItem>
				)}
			/>

			{frequency === "cron" && (
				<FormField
					control={form.control}
					name="cronExpression"
					render={({ field, fieldState }) => (
						<CronInput value={field.value || ""} onChange={field.onChange} error={fieldState.error?.message} />
					)}
				/>
			)}

			{frequency !== "hourly" && frequency !== "cron" && (
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
						<FormItem className="@md:col-span-2">
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

			{frequency === "monthly" && (
				<FormField
					control={form.control}
					name="monthlyDays"
					render={({ field }) => (
						<FormItem className="@md:col-span-2">
							<FormLabel>Days of the month</FormLabel>
							<FormControl>
								<div className="grid grid-cols-7 gap-4 w-max">
									{Array.from({ length: 31 }, (_, i) => {
										const day = (i + 1).toString();
										const isSelected = field.value?.includes(day);
										return (
											<Button
												type="button"
												key={day}
												variant={isSelected ? "primary" : "secondary"}
												size="icon"
												onClick={() => {
													const current = field.value || [];
													const next = isSelected ? current.filter((d) => d !== day) : [...current, day];
													field.onChange(next);
												}}
											>
												{day}
											</Button>
										);
									})}
								</div>
							</FormControl>
							<FormDescription>Select one or more days when the backup should run.</FormDescription>
							<FormMessage />
						</FormItem>
					)}
				/>
			)}
		</>
	);
};
