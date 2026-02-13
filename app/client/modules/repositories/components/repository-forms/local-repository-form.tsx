import { useState } from "react";
import type { UseFormReturn } from "react-hook-form";
import { Check, Pencil, X, AlertTriangle } from "lucide-react";
import { Button } from "../../../../components/ui/button";
import { FormItem, FormLabel, FormDescription, FormField, FormControl } from "../../../../components/ui/form";
import { DirectoryBrowser } from "../../../../components/directory-browser";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "../../../../components/ui/alert-dialog";
import type { RepositoryFormValues } from "../create-repository-form";
import { useServerFn } from "@tanstack/react-start";
import { getServerConstants } from "~/server/core/constants";
import { useSuspenseQuery } from "@tanstack/react-query";

type Props = {
	form: UseFormReturn<RepositoryFormValues>;
};

export const LocalRepositoryForm = ({ form }: Props) => {
	const [showPathBrowser, setShowPathBrowser] = useState(false);
	const [showPathWarning, setShowPathWarning] = useState(false);

	const getConstants = useServerFn(getServerConstants);
	const { data: constants } = useSuspenseQuery({
		queryKey: ["server-constants"],
		queryFn: getConstants,
	});

	return (
		<FormField
			control={form.control}
			name="path"
			render={({ field }) => (
				<>
					<FormItem>
						<FormLabel>Repository Directory</FormLabel>
						<FormControl>
							<div className="flex items-center gap-2">
								<div className="flex-1 text-sm font-mono bg-muted px-3 py-2 rounded-md border">
									{field.value || constants.REPOSITORY_BASE}
								</div>
								<Button type="button" variant="outline" onClick={() => setShowPathWarning(true)} size="sm">
									<Pencil className="h-4 w-4 mr-2" />
									Change
								</Button>
							</div>
						</FormControl>
						<FormDescription>The directory where the repository will be stored.</FormDescription>
					</FormItem>

					<AlertDialog open={showPathWarning} onOpenChange={setShowPathWarning}>
						<AlertDialogContent>
							<AlertDialogHeader>
								<AlertDialogTitle className="flex items-center gap-2">
									<AlertTriangle className="h-5 w-5 text-yellow-500" />
									Important: Host mount required
								</AlertDialogTitle>
								<AlertDialogDescription className="space-y-3">
									<p>When selecting a custom path, ensure it is mounted from the host machine into the container.</p>
									<p className="font-medium">
										If the path is not a host mount, you will lose your repository data when the container restarts.
									</p>
									<p className="text-sm text-muted-foreground">
										The default path <code className="bg-muted px-1 rounded">{constants.REPOSITORY_BASE}</code> is safe
										to use if you followed the recommended Docker Compose setup.
									</p>
								</AlertDialogDescription>
							</AlertDialogHeader>
							<AlertDialogFooter>
								<AlertDialogCancel>Cancel</AlertDialogCancel>
								<AlertDialogAction
									onClick={() => {
										setShowPathBrowser(true);
										setShowPathWarning(false);
									}}
								>
									I Understand, Continue
								</AlertDialogAction>
							</AlertDialogFooter>
						</AlertDialogContent>
					</AlertDialog>

					<AlertDialog open={showPathBrowser} onOpenChange={setShowPathBrowser}>
						<AlertDialogContent className="max-w-2xl">
							<AlertDialogHeader>
								<AlertDialogTitle>Select Repository Directory</AlertDialogTitle>
								<AlertDialogDescription>
									Choose a directory from the filesystem to store the repository.
								</AlertDialogDescription>
							</AlertDialogHeader>
							<div className="py-4">
								<DirectoryBrowser
									onSelectPath={(path) => {
										field.onChange(path);
									}}
									selectedPath={field.value || constants.REPOSITORY_BASE}
								/>
							</div>
							<AlertDialogFooter>
								<AlertDialogCancel>
									<X className="h-4 w-4 mr-2" />
									Cancel
								</AlertDialogCancel>
								<AlertDialogAction onClick={() => setShowPathBrowser(false)}>
									<Check className="h-4 w-4 mr-2" />
									Done
								</AlertDialogAction>
							</AlertDialogFooter>
						</AlertDialogContent>
					</AlertDialog>
				</>
			)}
		/>
	);
};
