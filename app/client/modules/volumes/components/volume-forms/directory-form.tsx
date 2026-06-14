import type { UseFormReturn } from "react-hook-form";
import type { FormValues } from "../create-volume-form";
import {
	FormControl,
	FormDescription,
	FormField,
	FormItem,
	FormLabel,
	FormMessage,
} from "../../../../components/ui/form";
import { FolderSelector } from "~/client/components/folder-selector";

type Props = {
	form: UseFormReturn<FormValues>;
};

export const DirectoryForm = ({ form }: Props) => {
	return (
		<FormField
			control={form.control}
			name="path"
			render={({ field }) => (
				<FormItem>
					<FormLabel>Directory Path</FormLabel>
					<FormControl>
						<FolderSelector value={field.value ?? ""} onChange={field.onChange} />
					</FormControl>
					<FormDescription>Browse and select a directory on the host filesystem to track.</FormDescription>
					<FormMessage />
				</FormItem>
			)}
		/>
	);
};
