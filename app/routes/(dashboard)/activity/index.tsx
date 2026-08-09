import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { listTaskHistory } from "~/client/api-client/sdk.gen";
import { useOrganizationContext } from "~/client/hooks/use-org-context";
import { TaskLogPage, type TaskLogKind, type TaskLogOutcome } from "~/client/modules/task-log/task-log";
import { taskHistoryOutcomeSchema } from "~/schemas/task-history";
import { taskKindSchema } from "~/schemas/tasks";

export const activitySearchSchema = z.object({
	kind: taskKindSchema.optional(),
	outcome: taskHistoryOutcomeSchema.optional(),
	page: z.coerce.number().int().positive().optional(),
});

export const Route = createFileRoute("/(dashboard)/activity/")({
	component: ActivityRoute,
	validateSearch: activitySearchSchema,
	loaderDeps: ({ search }) => {
		const page = search.page ?? 1;

		return { kind: search.kind, outcome: search.outcome, page };
	},
	loader: async ({ deps }) => {
		const query = { kind: deps.kind, outcome: deps.outcome, page: deps.page };
		const response = await listTaskHistory({ query });

		return response.data;
	},
	staticData: {
		breadcrumb: () => [{ label: "Activity" }],
	},
	head: () => ({
		meta: [
			{ title: "Zerobyte - Activity" },
			{
				name: "description",
				content: "Review backup, restore, and maintenance activity.",
			},
		],
	}),
});

function ActivityRoute() {
	const search = Route.useSearch();
	const navigate = Route.useNavigate();
	const initialData = Route.useLoaderData();
	const { activeOrganization } = useOrganizationContext();

	const updateKind = (kind: TaskLogKind | undefined) => {
		void navigate({
			search: (current) => ({ ...current, kind, page: undefined }),
			replace: true,
		});
	};

	const updateOutcome = (outcome: TaskLogOutcome | undefined) => {
		void navigate({
			search: (current) => ({ ...current, outcome, page: undefined }),
			replace: true,
		});
	};

	const updatePage = (page: number) => {
		void navigate({
			search: (current) => ({ ...current, page: page === 1 ? undefined : page }),
		});
	};

	return (
		<TaskLogPage
			initialData={initialData}
			organizationId={activeOrganization.id}
			kind={search.kind}
			outcome={search.outcome}
			page={search.page ?? 1}
			onKindChange={updateKind}
			onOutcomeChange={updateOutcome}
			onPageChange={updatePage}
		/>
	);
}
