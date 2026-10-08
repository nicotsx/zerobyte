import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { db } from "~/server/db/db";
import { agentsTable } from "~/server/db/schema";
import { LOCAL_AGENT_ID } from "../constants";
import { agentsService } from "../agents.service";
import { createTestSession } from "~/test/helpers/auth";
import { cryptoUtils } from "~/server/utils/crypto";
import { createAgentToken, parseAgentToken, validateRemoteAgentToken } from "../helpers/tokens";

beforeEach(async () => {
	await db.delete(agentsTable);
});

test("ensureLocalAgent seeds the built-in local agent once", async () => {
	await agentsService.ensureLocalAgent();
	await agentsService.ensureLocalAgent();

	const agents = await db.query.agentsTable.findMany();

	expect(agents).toHaveLength(1);
});

test("markAgentConnecting never creates an unenrolled remote", async () => {
	await expect(
		agentsService.markAgentConnecting({ agentId: "remote-agent", credentialVersion: 1 }),
	).resolves.toBeUndefined();

	expect(await agentsService.getAgent("remote-agent")).toBeUndefined();
});

test("markAgentConnecting preserves last-known capabilities until the next ready message", async () => {
	await agentsService.ensureLocalAgent();

	const trustedRoots = [{ id: "photos", label: "Photos", canBackup: true }];

	await agentsService.markAgentOnline({ agentId: LOCAL_AGENT_ID, credentialVersion: 0 }, { trustedRoots }, 1_000);
	await agentsService.markAgentOffline({ agentId: LOCAL_AGENT_ID, credentialVersion: 0 }, 2_000);

	await agentsService.markAgentConnecting({ agentId: LOCAL_AGENT_ID, credentialVersion: 0 });

	const agent = await agentsService.getAgent(LOCAL_AGENT_ID);

	expect(agent?.capabilities).toEqual({ trustedRoots });
});

test("agent runtime status moves from connecting to online, seen, and offline", async () => {
	await agentsService.ensureLocalAgent();
	await agentsService.markAgentConnecting({ agentId: LOCAL_AGENT_ID, credentialVersion: 0 });
	await agentsService.markAgentOnline({ agentId: LOCAL_AGENT_ID, credentialVersion: 0 }, {}, 2_000);
	await agentsService.markAgentSeen({ agentId: LOCAL_AGENT_ID, credentialVersion: 0 }, 3_000);
	await agentsService.markAgentOffline({ agentId: LOCAL_AGENT_ID, credentialVersion: 0 }, 4_000);

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
	const parsed = parseAgentToken(enrollment.token);
	const stored = await agentsService.getAgent(enrollment.agent.id);

	expect(parsed?.agentId).toBe(enrollment.agent.id);
	expect(stored?.credentialHash).toMatch(/^[a-f0-9]{64}$/);
	expect(stored?.credentialHash).not.toContain(enrollment.token.split(".")[3]);
	expect(await validateRemoteAgentToken(enrollment.token)).toBeNull();

	const machine = await agentsService.exchangeEnrollmentToken(enrollment.token);
	await expect(agentsService.exchangeEnrollmentToken(enrollment.token)).rejects.toThrow("Invalid or expired");

	expect(await validateRemoteAgentToken(machine.token)).toMatchObject({
		agentId: enrollment.agent.id,
		organizationId,
		agentKind: "remote",
		credentialVersion: 2,
	});
	expect(await validateRemoteAgentToken(machine.token.replace(".2.", ".02."))).toBeNull();

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
			credentialVersion: parseAgentToken(rotatedMachine.token)!.credentialVersion,
		}),
	).resolves.toBeUndefined();

	const readyAt = Date.now();

	expect(
		await agentsService.markAgentOnline(
			{ agentId: revoked.id, credentialVersion: rotation.agent.credentialVersion },
			{ protocolCompatible: true },
			readyAt,
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

test("a rotation that raced a revocation fails instead of moving the credential version backwards", async () => {
	const session = await createTestSession();
	const enrollment = await agentsService.createRemoteAgent(session.organizationId, "Raced agent");
	const deriveSecret = cryptoUtils.deriveSecret;

	vi.spyOn(cryptoUtils, "deriveSecret").mockImplementationOnce(async (label) => {
		await agentsService.revokeRemoteAgentToken(session.organizationId, enrollment.agent.id);
		return deriveSecret(label);
	});

	await expect(
		agentsService.rotateRemoteAgentToken(session.organizationId, enrollment.agent.id),
	).rejects.toMatchObject({ status: 409 });

	const stored = await agentsService.getAgent(enrollment.agent.id);

	expect(stored?.credentialVersion).toBe(enrollment.agent.credentialVersion + 1);
	expect(stored?.revokedAt).not.toBeNull();
	vi.restoreAllMocks();
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

describe("Agent tokens", () => {
	test("tokens carry the agent id and credential version and are backed by a keyed digest", async () => {
		const agentId = "019fe196-890d-7000-aa75-f958d70b8a96";
		const credentials = await createAgentToken(agentId, 7);
		const secret = credentials.token.split(".")[3] ?? "missing";

		expect(parseAgentToken(credentials.token)).toEqual({ agentId, credentialVersion: 7 });
		expect(Buffer.from(secret, "base64url")).toHaveLength(32);
		expect(credentials.credentialHash).toMatch(/^[a-f0-9]{64}$/);
		expect(credentials.credentialHash).not.toContain(secret);
	});

	test.each([
		"",
		"zba2.agent.1.secret",
		"zba1.agent.-1.secret",
		"zba1.agent..secret",
		"zba1..1.secret",
		"zba1.agent.1",
		"zba1.agent.1.secret.extra",
	])("rejects malformed agent token %j", (token) => {
		expect(parseAgentToken(token)).toBeNull();
	});

	test("new credentials use independent 256-bit random secrets", async () => {
		const first = await createAgentToken("agent-1", 1);
		const second = await createAgentToken("agent-1", 1);

		expect(first.token).not.toBe(second.token);
		expect(first.credentialHash).not.toBe(second.credentialHash);
	});
});
