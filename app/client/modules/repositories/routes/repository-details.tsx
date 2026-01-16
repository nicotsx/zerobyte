import { useQuery, useQueryClient } from "@tanstack/react-query";
import { redirect, useSearchParams } from "react-router";
import { useEffect } from "react";
import { getRepositoryOptions, listSnapshotsOptions } from "~/client/api-client/@tanstack/react-query.gen";
import { getRepository } from "~/client/api-client/sdk.gen";
import type { Route } from "./+types/repository-details";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "~/client/components/ui/tabs";
import { RepositoryInfoTabContent } from "../tabs/info";
import { RepositorySnapshotsTabContent } from "../tabs/snapshots";

export const handle = {
	breadcrumb: (match: Route.MetaArgs) => [
		{ label: "Repositories", href: "/repositories" },
		{ label: match.loaderData?.name || match.params.id },
	],
};

export function meta({ params, loaderData }: Route.MetaArgs) {
	return [
		{ title: `Zerobyte - ${loaderData?.name || params.id}` },
		{
			name: "description",
			content: "View repository configuration, status, and snapshots.",
		},
	];
}

export const clientLoader = async ({ params }: Route.ClientLoaderArgs) => {
	const repository = await getRepository({ path: { id: params.id ?? "" } });
	if (repository.data) return repository.data;

	return redirect("/repositories");
};

export default function RepositoryDetailsPage({ loaderData }: Route.ComponentProps) {
	const queryClient = useQueryClient();

	const [searchParams, setSearchParams] = useSearchParams();
	const activeTab = searchParams.get("tab") || "info";

	const { data } = useQuery({
		...getRepositoryOptions({ path: { id: loaderData.id } }),
		initialData: loaderData,
	});

	useEffect(() => {
		void queryClient.prefetchQuery(listSnapshotsOptions({ path: { id: data.id } }));
	}, [queryClient, data.id]);

	return (
		<>
			<Tabs value={activeTab} onValueChange={(value) => setSearchParams({ tab: value })}>
				<TabsList className="mb-2">
					<TabsTrigger value="info">Configuration</TabsTrigger>
					<TabsTrigger value="snapshots">Snapshots</TabsTrigger>
				</TabsList>
				<TabsContent value="info">
					<RepositoryInfoTabContent repository={data} />
				</TabsContent>
				<TabsContent value="snapshots">
					<RepositorySnapshotsTabContent repository={data} />
				</TabsContent>
			</Tabs>
		</>
	);
}
