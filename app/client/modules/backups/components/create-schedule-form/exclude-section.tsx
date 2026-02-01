import { FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "~/client/components/ui/form";
import { Textarea } from "~/client/components/ui/textarea";
import { Checkbox } from "~/client/components/ui/checkbox";
import type { UseFormReturn } from "react-hook-form";
import type { InternalFormValues } from "./types";

type ExcludeSectionProps = {
	form: UseFormReturn<InternalFormValues>;
};

export const ExcludeSection = ({ form }: ExcludeSectionProps) => {
	return (
		<>
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
								className="font-mono text-sm min-h-30"
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
			<FormField
				control={form.control}
				name="excludeIfPresentText"
				render={({ field }) => (
					<FormItem className="mt-6">
						<FormLabel>Exclude if file present</FormLabel>
						<FormControl>
							<Textarea
								{...field}
								placeholder=".nobackup&#10;.exclude-from-backup&#10;CACHEDIR.TAG"
								className="font-mono text-sm min-h-20"
							/>
						</FormControl>
						<FormDescription>
							Exclude folders containing a file with the specified name. Enter one filename per line. For example, use{" "}
							<code className="bg-muted px-1 rounded">.nobackup</code> to skip any folder containing a{" "}
							<code className="bg-muted px-1 rounded">.nobackup</code> file.
						</FormDescription>
						<FormMessage />
					</FormItem>
				)}
			/>
			<FormField
				control={form.control}
				name="oneFileSystem"
				render={({ field }) => (
					<FormItem className="flex flex-row items-start space-x-3 space-y-0 rounded-md border p-4 mt-6">
						<FormControl>
							<Checkbox checked={field.value} onCheckedChange={field.onChange} />
						</FormControl>
						<div className="space-y-1 leading-none">
							<FormLabel>Stay on one file system</FormLabel>
							<FormDescription>
								Prevent Restic from crossing file system boundaries. This is useful to avoid backing up network mounts
								or other partitions that might be mounted inside your backup source.
							</FormDescription>
						</div>
					</FormItem>
				)}
			/>
		</>
	);
};
