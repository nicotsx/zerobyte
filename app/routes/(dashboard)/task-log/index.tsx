import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { TaskLogPage, type TaskLogKind, type TaskLogOutcome } from "~/client/modules/task-log/task-log";
import { taskHistoryOutcomeSchema } from "~/schemas/task-history";
import { taskKindSchema } from "~/schemas/tasks";

export const taskLogSearchSchema = z.object({
	kind: taskKindSchema.optional(),
	outcome: taskHistoryOutcomeSchema.optional(),
	page: z.coerce.number().int().positive().optional(),
});

export const Route = createFileRoute("/(dashboard)/task-log/")({
	component: TaskLogRoute,
	validateSearch: taskLogSearchSchema,
	staticData: {
		breadcrumb: () => [{ label: "Task Log" }],
	},
	head: () => ({
		meta: [
			{ title: "Zerobyte - Task Log" },
			{
				name: "description",
				content: "Audit persisted task outcomes and lifecycle details.",
			},
		],
	}),
});

function TaskLogRoute() {
	const search = Route.useSearch();
	const navigate = Route.useNavigate();
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
			kind={search.kind}
			outcome={search.outcome}
			page={search.page ?? 1}
			onKindChange={updateKind}
			onOutcomeChange={updateOutcome}
			onPageChange={updatePage}
		/>
	);
}
