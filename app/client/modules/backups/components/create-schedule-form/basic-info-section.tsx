import { useQuery } from "@tanstack/react-query";
import { listRepositoriesOptions } from "~/client/api-client/@tanstack/react-query.gen";
import { RepositoryIcon } from "~/client/components/repository-icon";
import { FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "~/client/components/ui/form";
import { Input } from "~/client/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "~/client/components/ui/select";
import type { Volume } from "~/client/lib/types";
import type { UseFormReturn } from "react-hook-form";
import type { InternalFormValues } from "./types";

type BasicInfoSectionProps = {
	form: UseFormReturn<InternalFormValues>;
	volume: Volume;
};

export const BasicInfoSection = ({ form, volume }: BasicInfoSectionProps) => {
	const { data: repositoriesData } = useQuery({
		...listRepositoriesOptions(),
	});

	return (
		<>
			<FormField
				control={form.control}
				name="name"
				render={({ field }) => (
					<FormItem className="@md:col-span-2">
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
					<FormItem className="@md:col-span-2">
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
		</>
	);
};
