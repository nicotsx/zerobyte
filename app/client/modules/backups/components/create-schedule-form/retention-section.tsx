import { FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "~/client/components/ui/form";
import { Input } from "~/client/components/ui/input";
import type { UseFormReturn } from "react-hook-form";
import type { InternalFormValues } from "./types";

type RetentionSectionProps = {
	form: UseFormReturn<InternalFormValues>;
};

export const RetentionSection = ({ form }: RetentionSectionProps) => {
	return (
		<>
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
		</>
	);
};
