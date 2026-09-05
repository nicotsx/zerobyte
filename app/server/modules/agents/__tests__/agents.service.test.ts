import { eq } from "drizzle-orm";
import { beforeEach, expect, test } from "vitest";
import { db } from "~/server/db/db";
import { agentsTable } from "~/server/db/schema";
import { LOCAL_AGENT_ID, LOCAL_AGENT_KIND, LOCAL_AGENT_NAME } from "../constants";
import { agentsService } from "../agents.service";
import { createTestSession } from "~/test/helpers/auth";
import { parseEnrollmentToken, validateRemoteAgentToken } from "../helpers/tokens";

beforeEach(async () => {
	await db.delete(agentsTable);
});

test("ensureLocalAgent seeds the built-in local agent once", async () => {
	await agentsService.ensureLocalAgent();
	await agentsService.ensureLocalAgent();

	const agents = await agentsService.listAgents();

	expect(agents).toHaveLength(1);
});

test("markAgentConnecting never creates an unenrolled remote", async () => {
	await expect(
		agentsService.markAgentConnecting({
			agentId: "remote-agent",
			organizationId: null,
			agentName: "Remote Agent",
			agentKind: "remote",
			credentialVersion: 1,
			connectedAt: 1_000,
		}),
	).rejects.toThrow("enrollment changed");
	expect(await agentsService.getAgent("remote-agent")).toBeUndefined();
});

test("markAgentConnecting preserves last-known capabilities until the next ready message", async () => {
	await agentsService.ensureLocalAgent();
	const trustedRoots = [{ id: "photos", label: "Photos", canBackup: true }];
	await agentsService.markAgentConnecting({
		agentId: LOCAL_AGENT_ID,
		organizationId: null,
		agentName: LOCAL_AGENT_NAME,
		agentKind: LOCAL_AGENT_KIND,
		credentialVersion: 0,
		capabilities: { trustedRoots },
		connectedAt: 1_000,
	});
	await agentsService.markAgentOffline(LOCAL_AGENT_ID, 2_000);
	await agentsService.markAgentConnecting({
		agentId: LOCAL_AGENT_ID,
		organizationId: null,
		agentName: LOCAL_AGENT_NAME,
		agentKind: LOCAL_AGENT_KIND,
		credentialVersion: 0,
		connectedAt: 3_000,
	});

	const agent = await agentsService.getAgent(LOCAL_AGENT_ID);
	expect(agent?.capabilities).toEqual({ trustedRoots });
});

test("agent runtime status moves from connecting to online, seen, and offline", async () => {
	await agentsService.ensureLocalAgent();
	await agentsService.markAgentConnecting({
		agentId: LOCAL_AGENT_ID,
		organizationId: null,
		agentName: LOCAL_AGENT_NAME,
		agentKind: LOCAL_AGENT_KIND,
		credentialVersion: 0,
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

test("remote enrollment stores only a keyed digest and rotation/revocation invalidate prior tokens", async () => {
	const { organizationId } = await createTestSession();
	const enrollment = await agentsService.createRemoteAgent(organizationId, "Branch office");
	const parsed = parseEnrollmentToken(enrollment.token);
	const stored = await agentsService.getAgent(enrollment.agent.id);

	expect(parsed?.agentId).toBe(enrollment.agent.id);
	expect(stored?.credentialHash).toMatch(/^[a-f0-9]{64}$/);
	expect(stored?.credentialHash).not.toContain(enrollment.token);
	expect(stored?.credentialHash).not.toContain(parsed?.secret.toString("base64url") ?? "missing");
	expect(await validateRemoteAgentToken(enrollment.token)).toBeNull();
	const machine = await agentsService.exchangeEnrollmentToken(enrollment.token);
	await expect(agentsService.exchangeEnrollmentToken(enrollment.token)).rejects.toThrow("Invalid or expired");
	expect(await validateRemoteAgentToken(machine.token)).toMatchObject({
		agentId: enrollment.agent.id,
		organizationId,
		agentKind: "remote",
		credentialVersion: 2,
	});

	const rotation = await agentsService.rotateRemoteAgentToken(organizationId, enrollment.agent.id);
	expect(rotation.token).not.toBe(enrollment.token);
	expect(await validateRemoteAgentToken(enrollment.token)).toBeNull();
	expect(await validateRemoteAgentToken(rotation.token)).toBeNull();
	const rotatedMachine = await agentsService.exchangeEnrollmentToken(rotation.token);
	expect(await validateRemoteAgentToken(rotatedMachine.token)).not.toBeNull();

	const revoked = await agentsService.revokeRemoteAgentToken(organizationId, enrollment.agent.id);
	const expectedRevokedVersion = rotation.agent.credentialVersion + 2;
	expect(revoked.revokedAt).toEqual(expect.any(Number));
	expect(revoked.credentialVersion).toBe(expectedRevokedVersion);
	expect(await validateRemoteAgentToken(rotation.token)).toBeNull();
	await expect(
		agentsService.markAgentConnecting({
			agentId: revoked.id,
			organizationId,
			agentName: revoked.name,
			agentKind: "remote",
			credentialVersion: revoked.credentialVersion,
		}),
	).rejects.toThrow("enrollment changed");
	const readyAt = Date.now();
	expect(
		await agentsService.markAgentOnline(
			revoked.id,
			readyAt,
			{ protocolCompatible: true },
			rotation.agent.credentialVersion,
		),
	).toBeUndefined();
	const storedAfterRevoke = await agentsService.getAgent(revoked.id);
	expect(storedAfterRevoke?.status).toBe("offline");
});

test("remote mutations are organization-scoped and cannot target the built-in agent", async () => {
	const first = await createTestSession();
	const second = await createTestSession();
	const enrollment = await agentsService.createRemoteAgent(first.organizationId, "First org");
	await agentsService.ensureLocalAgent();

	await expect(agentsService.rotateRemoteAgentToken(second.organizationId, enrollment.agent.id)).rejects.toThrow(
		"Remote agent not found",
	);
	await expect(agentsService.revokeRemoteAgentToken(first.organizationId, LOCAL_AGENT_ID)).rejects.toThrow(
		"Remote agent not found",
	);
});
test("expired enrollment codes cannot become machine credentials", async () => {
	const { organizationId } = await createTestSession();
	const enrollment = await agentsService.createRemoteAgent(organizationId, "Expired");
	await db
		.update(agentsTable)
		.set({ enrollmentExpiresAt: Date.now() - 1 })
		.where(eq(agentsTable.id, enrollment.agent.id));
	await expect(agentsService.exchangeEnrollmentToken(enrollment.token)).rejects.toThrow("Invalid or expired");
	expect(await validateRemoteAgentToken(enrollment.token)).toBeNull();
});

test("only one concurrent enrollment exchange succeeds", async () => {
	const { organizationId } = await createTestSession();
	const enrollment = await agentsService.createRemoteAgent(organizationId, "Concurrent");
	const results = await Promise.allSettled([
		agentsService.exchangeEnrollmentToken(enrollment.token),
		agentsService.exchangeEnrollmentToken(enrollment.token),
	]);
	expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
	expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
});
