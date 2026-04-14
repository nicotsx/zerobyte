import { beforeEach, expect, test } from "vitest";
import { db } from "~/server/db/db";
import { agentsTable } from "~/server/db/schema";
import { agentsService } from "../agents.service";

beforeEach(async () => {
	await db.delete(agentsTable);
});

test("ensureLocalAgent seeds the built-in local agent once", async () => {
	await agentsService.ensureLocalAgent();
	await agentsService.ensureLocalAgent();

	const agents = await agentsService.listAgents();

	expect(agents).toHaveLength(1);
});
