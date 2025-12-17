import { useState } from "react";
import type { UseFormReturn } from "react-hook-form";
import { Check, Pencil, X, AlertTriangle } from "lucide-react";
import { Button } from "../../../../components/ui/button";
import { FormItem, FormLabel, FormDescription } from "../../../../components/ui/form";
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

type Props = {
	form: UseFormReturn<RepositoryFormValues>;
};

export const LocalRepositoryForm = ({ form }: Props) => {
	const [showPathBrowser, setShowPathBrowser] = useState(false);
	const [showPathWarning, setShowPathWarning] = useState(false);

	return (
		<>
			<FormItem>
				<FormLabel>Repository Directory</FormLabel>
				<div className="flex items-center gap-2">
					<div className="flex-1 text-sm font-mono bg-muted px-3 py-2 rounded-md border">
						{form.watch("path") || "/var/lib/zerobyte/repositories"}
					</div>
					<Button type="button" variant="outline" onClick={() => setShowPathWarning(true)} size="sm">
						<Pencil className="h-4 w-4 mr-2" />
						Change
					</Button>
				</div>
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
								The default path <code className="bg-muted px-1 rounded">/var/lib/zerobyte/repositories</code> is
								already mounted from the host and is safe to use.
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
							onSelectPath={(path) => form.setValue("path", path)}
							selectedPath={form.watch("path") || "/var/lib/zerobyte/repositories"}
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
	);
};
