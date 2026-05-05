import { beforeEach, expect, test } from "vitest";
import { db } from "~/server/db/db";
import { agentsTable } from "~/server/db/schema";
import { LOCAL_AGENT_ID, LOCAL_AGENT_KIND, LOCAL_AGENT_NAME } from "../constants";
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

test("markAgentConnecting creates and updates connection metadata", async () => {
	await agentsService.markAgentConnecting({
		agentId: "remote-agent",
		organizationId: null,
		agentName: "Remote Agent",
		agentKind: "remote",
		capabilities: { restic: true },
		connectedAt: 1_000,
	});
	await agentsService.markAgentConnecting({
		agentId: "remote-agent",
		organizationId: null,
		agentName: "Renamed Agent",
		agentKind: "remote",
		capabilities: { restic: true, webdav: true },
		connectedAt: 2_000,
	});

	const agent = await agentsService.getAgent("remote-agent");

	expect(agent).toMatchObject({
		id: "remote-agent",
		name: "Renamed Agent",
		kind: "remote",
		status: "connecting",
		capabilities: { restic: true, webdav: true },
		lastSeenAt: 2_000,
		updatedAt: 2_000,
	});
});

test("agent runtime status moves from connecting to online, seen, and offline", async () => {
	await agentsService.markAgentConnecting({
		agentId: LOCAL_AGENT_ID,
		organizationId: null,
		agentName: LOCAL_AGENT_NAME,
		agentKind: LOCAL_AGENT_KIND,
		connectedAt: 1_000,
	});
	await agentsService.markAgentOnline(LOCAL_AGENT_ID, 2_000);
	await agentsService.markAgentSeen(LOCAL_AGENT_ID, 3_000);
	await agentsService.markAgentOffline(LOCAL_AGENT_ID, 4_000);

	const agent = await agentsService.getAgent(LOCAL_AGENT_ID);

	expect(agent).toMatchObject({
		id: LOCAL_AGENT_ID,
		status: "offline",
		lastSeenAt: 3_000,
		lastReadyAt: 2_000,
		updatedAt: 4_000,
	});
});
