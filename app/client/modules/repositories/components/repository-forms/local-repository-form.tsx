import type { UseFormReturn } from "react-hook-form";
import { useWatch } from "react-hook-form";
import { AlertTriangle } from "lucide-react";
import { FormItem, FormLabel, FormDescription, FormField, FormControl } from "../../../../components/ui/form";
import type { RepositoryFormValues } from "../create-repository-form";
import { useServerFn } from "@tanstack/react-start";
import { getServerConstants } from "~/server/lib/functions/server-constants";
import { useSuspenseQuery } from "@tanstack/react-query";
import { FolderSelector } from "~/client/components/folder-selector";

type Props = {
	form: UseFormReturn<RepositoryFormValues>;
};

export const LocalRepositoryForm = ({ form }: Props) => {
	const getConstants = useServerFn(getServerConstants);
	const { data: constants } = useSuspenseQuery({
		queryKey: ["server-constants"],
		queryFn: getConstants,
	});

	const isExistingRepository = useWatch({ control: form.control, name: "isExistingRepository" });

	return (
		<FormField
			control={form.control}
			name="path"
			render={({ field }) => (
				<FormItem>
					<FormLabel>Repository Directory</FormLabel>
					<FormControl>
						<FolderSelector
							value={field.value || constants.REPOSITORY_BASE}
							onChange={field.onChange}
							displayValue={
								<>
									{field.value || constants.REPOSITORY_BASE}
									{!isExistingRepository && (
										<span className="text-muted-foreground">/{"{unique-id}"}</span>
									)}
								</>
							}
							webBrowser={{
								mode: "dialog",
								title: "Select Repository Directory",
								description: "Choose a directory from the filesystem to store the repository.",
								warning: {
									title: (
										<>
											<AlertTriangle className="h-5 w-5 text-yellow-500" />
											Important: Host mount required
										</>
									),
									description: (
										<>
											<p>
												When selecting a custom path, ensure it is mounted from the host machine
												into the container.
											</p>
											<p className="font-medium">
												If the path is not a host mount, you will lose your repository data when
												the container restarts.
											</p>
											<p className="text-sm text-muted-foreground">
												The default path{" "}
												<code className="bg-muted px-1 rounded">
													{constants.REPOSITORY_BASE}
												</code>{" "}
												is safe to use if you followed the recommended Docker Compose setup.
											</p>
										</>
									),
									continueLabel: "I Understand, Continue",
								},
							}}
						/>
					</FormControl>
					<FormDescription>
						{isExistingRepository
							? "The exact path to your existing repository."
							: "A unique subdirectory will be created inside this directory to store the repository."}
					</FormDescription>
				</FormItem>
			)}
		/>
	);
};
