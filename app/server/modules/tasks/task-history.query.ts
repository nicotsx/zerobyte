import { and, count, desc, eq, inArray, type SQL } from "drizzle-orm";
import type { TaskHistoryOutcome } from "~/schemas/task-history";
import {
	activeTaskStatuses,
	persistedTaskSchema,
	TASK_PERSISTENCE_FORMAT_VERSION,
	type TaskKind,
} from "~/schemas/tasks";
import { db } from "~/server/db/db";
import { tasksTable } from "~/server/db/schema";
import type { TaskHistoryResponse } from "./task-history.dto";
import { toTaskHistoryItem } from "./task-history.presenter";

export const TASK_HISTORY_PAGE_SIZE = 25;

type ListTaskHistoryParams = {
	organizationId: string;
	kind?: TaskKind;
	outcome?: TaskHistoryOutcome;
	page: number;
};

export const listTaskHistory = (params: ListTaskHistoryParams): TaskHistoryResponse => {
	const conditions: SQL[] = [
		eq(tasksTable.organizationId, params.organizationId),
		eq(tasksTable.persistenceFormatVersion, TASK_PERSISTENCE_FORMAT_VERSION),
	];
	if (params.kind) conditions.push(eq(tasksTable.kind, params.kind));
	if (params.outcome === "running") {
		conditions.push(inArray(tasksTable.status, activeTaskStatuses));
	} else if (params.outcome) {
		conditions.push(eq(tasksTable.outcome, params.outcome));
	}

	const where = and(...conditions);
	const offset = (params.page - 1) * TASK_HISTORY_PAGE_SIZE;
	const result = db.transaction((tx) => {
		const total = tx.select({ value: count() }).from(tasksTable).where(where).get();
		const rows = tx
			.select()
			.from(tasksTable)
			.where(where)
			.orderBy(desc(tasksTable.createdAt), desc(tasksTable.id))
			.limit(TASK_HISTORY_PAGE_SIZE)
			.offset(offset)
			.all();

		return { rows, totalItems: total?.value ?? 0 };
	});
	const tasks = result.rows.map((row) => persistedTaskSchema.parse(row));
	const totalItems = result.totalItems;
	const totalPages = Math.ceil(totalItems / TASK_HISTORY_PAGE_SIZE);

	return {
		organizationId: params.organizationId,
		items: tasks.map(toTaskHistoryItem),
		page: params.page,
		pageSize: TASK_HISTORY_PAGE_SIZE,
		totalItems,
		totalPages,
	};
};
