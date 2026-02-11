import { useSuspenseQuery } from "@tanstack/react-query";
import { Suspense } from "react";
import { getRepositoryOptions } from "~/client/api-client/@tanstack/react-query.gen";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "~/client/components/ui/tabs";
import { RepositoryInfoTabContent } from "../tabs/info";
import { RepositorySnapshotsTabContent } from "../tabs/snapshots";
import { useNavigate, useSearch } from "@tanstack/react-router";

export const handle = {
	breadcrumb: (match: Route.MetaArgs) => [
		{ label: "Repositories", href: "/repositories" },
		{ label: match.loaderData?.name || match.params.id },
	],
};

export default function RepositoryDetailsPage({ repositoryId }: { repositoryId: string }) {
	const navigate = useNavigate();
	const { tab } = useSearch({ from: "/(dashboard)/repositories/$repositoryId" });
	const activeTab = tab || "info";

	const { data } = useSuspenseQuery({
		...getRepositoryOptions({ path: { id: repositoryId } }),
	});

	return (
		<>
			<Tabs value={activeTab} onValueChange={(value) => navigate({ to: ".", search: (s) => ({ ...s, tab: value }) })}>
				<TabsList className="mb-2">
					<TabsTrigger value="info">Configuration</TabsTrigger>
					<TabsTrigger value="snapshots">Snapshots</TabsTrigger>
				</TabsList>
				<TabsContent value="info">
					<RepositoryInfoTabContent repository={data} />
				</TabsContent>
				<TabsContent value="snapshots">
					<Suspense>
						<RepositorySnapshotsTabContent repository={data} />
					</Suspense>
				</TabsContent>
			</Tabs>
		</>
	);
}
