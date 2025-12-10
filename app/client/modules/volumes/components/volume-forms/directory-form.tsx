import { Pencil } from "lucide-react";
import type { UseFormReturn } from "react-hook-form";
import type { FormValues } from "../create-volume-form";
import { DirectoryBrowser } from "../../../../components/directory-browser";
import { Button } from "../../../../components/ui/button";
import {
	FormControl,
	FormDescription,
	FormField,
	FormItem,
	FormLabel,
	FormMessage,
} from "../../../../components/ui/form";

type Props = {
	form: UseFormReturn<FormValues>;
};

export const DirectoryForm = ({ form }: Props) => {
	return (
		<FormField
			control={form.control}
			name="path"
			render={({ field }) => {
				return (
					<FormItem>
						<FormLabel>Directory Path</FormLabel>
						<FormControl>
							{field.value ? (
								<div className="flex items-center gap-2">
									<div className="flex-1 border rounded-md p-3 bg-muted/50">
										<div className="text-xs font-medium text-muted-foreground mb-1">Selected path:</div>
										<div className="text-sm font-mono break-all">{field.value}</div>
									</div>
									<Button type="button" variant="outline" size="sm" onClick={() => field.onChange("")}>
										<Pencil className="h-4 w-4 mr-2" />
										Change
									</Button>
								</div>
							) : (
								<DirectoryBrowser onSelectPath={(path) => field.onChange(path)} selectedPath={field.value} />
							)}
						</FormControl>
						<FormDescription>Browse and select a directory on the host filesystem to track.</FormDescription>
						<FormMessage />
					</FormItem>
				);
			}}
		/>
	);
};
