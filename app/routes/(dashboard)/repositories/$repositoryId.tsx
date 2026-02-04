import { createFileRoute } from "@tanstack/react-router";
import { type } from "arktype";
import {
	getRepositoryOptions,
	listBackupSchedulesOptions,
	listSnapshotsOptions,
} from "~/client/api-client/@tanstack/react-query.gen";
import RepositoryDetailsPage from "~/client/modules/repositories/routes/repository-details";

export const Route = createFileRoute("/(dashboard)/repositories/$repositoryId")({
	component: RouteComponent,
	errorComponent: (e) => <div>{e.error.message}</div>,
	loader: async ({ params, context }) => {
		context.queryClient.prefetchQuery({
			...listSnapshotsOptions({ path: { id: params.repositoryId } }),
		})
		context.queryClient.prefetchQuery({
			...listBackupSchedulesOptions(),
		})

		const res = await context.queryClient.ensureQueryData({
			...getRepositoryOptions({ path: { id: params.repositoryId } }),
		})

		return res;
	},
	validateSearch: type({ tab: "string?" }),
	head: ({ loaderData }) => ({
		meta: [
			{ title: `Zerobyte - ${loaderData?.name}` },
			{
				name: "description",
				content: "View repository configuration, status, and snapshots.",
			},
		],
	}),
});

function RouteComponent() {
	const { repositoryId } = Route.useParams();

	return <RepositoryDetailsPage repositoryId={repositoryId} />;
}
