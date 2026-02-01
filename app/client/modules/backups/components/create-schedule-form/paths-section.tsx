import { X } from "lucide-react";
import { VolumeFileBrowser } from "~/client/components/volume-file-browser";
import { FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "~/client/components/ui/form";
import { Textarea } from "~/client/components/ui/textarea";
import type { Volume } from "~/client/lib/types";
import type { UseFormReturn } from "react-hook-form";
import type { InternalFormValues } from "./types";

type PathsSectionProps = {
	form: UseFormReturn<InternalFormValues>;
	volume: Volume;
	selectedPaths: Set<string>;
	onSelectionChange: (paths: Set<string>) => void;
	onRemovePath: (path: string) => void;
	showAllSelectedPaths: boolean;
	onToggleShowAllPaths: () => void;
};

export const PathsSection = ({
	form,
	volume,
	selectedPaths,
	onSelectionChange,
	onRemovePath,
	showAllSelectedPaths,
	onToggleShowAllPaths,
}: PathsSectionProps) => {
	return (
		<>
			<VolumeFileBrowser
				key={volume.id}
				volumeId={volume.shortId}
				selectedPaths={selectedPaths}
				onSelectionChange={onSelectionChange}
				withCheckboxes={true}
				foldersOnly={false}
				className="relative border rounded-md bg-card p-2 h-100 overflow-y-auto"
			/>
			{selectedPaths.size > 0 && (
				<div className="mt-4">
					<p className="text-xs text-muted-foreground mb-2">Selected paths:</p>
					<div className="flex flex-wrap gap-2">
						{Array.from(selectedPaths)
							.slice(0, showAllSelectedPaths ? undefined : 20)
							.map((path) => (
								<span
									key={path}
									className="text-xs bg-accent px-2 py-1 rounded-md font-mono inline-flex items-center gap-1"
								>
									{path}
									<button
										type="button"
										onClick={() => onRemovePath(path)}
										className="ml-1 hover:bg-destructive/20 rounded p-0.5 transition-colors"
										aria-label={`Remove ${path}` as string}
									>
										<X className="h-3 w-3" />
									</button>
								</span>
							))}
						{selectedPaths.size > 20 && (
							<button type="button" onClick={onToggleShowAllPaths} className="text-xs text-primary hover:underline">
								{showAllSelectedPaths ? "Show less" : `+ ${selectedPaths.size - 20} more`}
							</button>
						)}
					</div>
				</div>
			)}
			<FormField
				control={form.control}
				name="includePatternsText"
				render={({ field }) => (
					<FormItem className="mt-6">
						<FormLabel>Additional include patterns</FormLabel>
						<FormControl>
							<Textarea
								{...field}
								placeholder="/data/**&#10;/config/*.json&#10;*.db"
								className="font-mono text-sm min-h-25"
							/>
						</FormControl>
						<FormDescription>
							Optionally add custom include patterns using glob syntax. Enter one pattern per line. These will be
							combined with the paths selected above.
						</FormDescription>
						<FormMessage />
					</FormItem>
				)}
			/>
		</>
	);
};
