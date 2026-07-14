import { and, count, desc, eq, type SQL } from "drizzle-orm";
import type { TaskHistoryOutcome } from "~/schemas/task-history";
import { persistedTaskSchema, type TaskKind } from "~/schemas/tasks";
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
	const conditions: SQL[] = [eq(tasksTable.organizationId, params.organizationId)];
	if (params.kind) conditions.push(eq(tasksTable.kind, params.kind));
	if (params.outcome) conditions.push(eq(tasksTable.outcome, params.outcome));

	const where = and(...conditions);
	const [{ count: totalItems }] = db.select({ count: count() }).from(tasksTable).where(where).all();
	const totalPages = Math.ceil(totalItems / TASK_HISTORY_PAGE_SIZE);
	const tasks = db
		.select()
		.from(tasksTable)
		.where(where)
		.orderBy(desc(tasksTable.createdAt), desc(tasksTable.id))
		.limit(TASK_HISTORY_PAGE_SIZE)
		.offset((params.page - 1) * TASK_HISTORY_PAGE_SIZE)
		.all()
		.map((row) => persistedTaskSchema.parse(row));

	return {
		items: tasks.map(toTaskHistoryItem),
		page: params.page,
		pageSize: TASK_HISTORY_PAGE_SIZE,
		totalItems,
		totalPages,
	};
};
