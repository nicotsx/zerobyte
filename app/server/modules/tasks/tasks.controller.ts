import { Hono } from "hono";
import { validator } from "hono-openapi";
import { requireAuth } from "../auth/auth.middleware";
import { listTasksDto, listTasksQuery, type ListTasksDto, type TaskDto } from "./tasks.dto";
import type { ParsedTask } from "./tasks.schemas";
import { taskStore } from "./tasks.store";

const toTaskDto = (task: ParsedTask): TaskDto => {
	const { organizationId: _organizationId, ...taskDto } = task;
	return taskDto;
};

export const tasksController = new Hono()
	.use(requireAuth)
	.get("/", validator("query", listTasksQuery), listTasksDto, async (c) => {
		const organizationId = c.get("organizationId");
		const { kind } = c.req.valid("query");
		const tasks = taskStore.listActive({ organizationId, kind });
		const response = tasks.map(toTaskDto);

		return c.json<ListTasksDto>(response, 200);
	});
