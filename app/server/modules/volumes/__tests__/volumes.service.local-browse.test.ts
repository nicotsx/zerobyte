import { afterEach, expect, test } from "vitest";
import { eq } from "drizzle-orm";
import { config } from "~/server/core/config";
import { withContext } from "~/server/core/request-context";
import { db } from "~/server/db/db";
import { agentsTable } from "~/server/db/schema";
import { createApp } from "~/server/app";
import { createTestSession } from "~/test/helpers/auth";
import { getAgentRuntimeState } from "../../agents/helpers/runtime-state";
import { createAgentController } from "../../agents/controller/server";
import { volumeService } from "../volume.service";

const remoteAgentsEnabled = config.flags.enableRemoteAgents;

afterEach(() => {
	config.flags.enableRemoteAgents = remoteAgentsEnabled;
	getAgentRuntimeState().controller = null;
});

test.each([false, true])("local browsing requires a worker with runtime present=%s", async (runtimePresent) => {
	const { organizationId, user, headers } = await createTestSession();
	await db.delete(agentsTable).where(eq(agentsTable.id, "local"));
	await db.insert(agentsTable).values({
		id: "local",
		name: "Local Agent",
		kind: "local",
		status: "offline",
		capabilities: {
			filesystem: true,
			trustedRoots: [{ id: "local-filesystem", label: "Local filesystem", canBackup: true }],
		},
	});
	config.flags.enableRemoteAgents = false;
	getAgentRuntimeState().controller = runtimePresent ? createAgentController(() => {}) : null;

	await withContext({ organizationId, userId: user.id }, async () => {
		await expect(volumeService.browseFilesystem("local", "local-filesystem", "")).rejects.toMatchObject({
			statusCode: 503,
		});
		await expect(volumeService.browseFilesystem("local", "missing", "")).rejects.toMatchObject({ statusCode: 400 });
		await expect(volumeService.browseFilesystem("local", "local-filesystem", "../outside")).rejects.toMatchObject({
			statusCode: 400,
		});
		await expect(volumeService.browseFilesystem("local", "local-filesystem", "/absolute")).rejects.toMatchObject({
			statusCode: 400,
		});
	});

	const app = createApp();
	for (const identifiers of ["", "&agentId=local&rootId=local-filesystem"]) {
		const response = await app.request(`/api/v1/volumes/filesystem/browse?path=${identifiers}`, { headers });
		expect(response.status).toBe(503);
	}
});
