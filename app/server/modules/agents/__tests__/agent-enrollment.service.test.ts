import { logger } from "@zerobyte/core/node";
import { afterEach, expect, test, vi } from "vitest";
import { createAgentEnrollmentService } from "../agent-enrollment.service";

afterEach(() => {
	vi.restoreAllMocks();
});

const agent = {
	id: "agent-1",
	organizationId: "org-1",
	name: "Agent 1",
	kind: "remote" as const,
	status: "offline" as const,
	capabilities: {},
	lastSeenAt: null,
	lastReadyAt: null,
	createdAt: 1,
	updatedAt: 1,
	revokedAt: null,
	credentialVersion: 2,
};
const rotation = { agent, expiresAt: Date.now() + 60_000, token: "one-time-token" };
const revoked = { ...agent, revokedAt: 1 };

test("rotation and revocation persist before disconnecting and preserve their responses", async () => {
	const order: string[] = [];
	const persistence = {
		createRemoteAgent: vi.fn(),
		rotateRemoteAgentToken: vi.fn(async () => {
			order.push("rotate");
			return rotation;
		}),
		revokeRemoteAgentToken: vi.fn(async () => {
			order.push("revoke");
			return revoked;
		}),
	};
	const disconnectPort = {
		disconnectAgent: vi.fn(async () => {
			order.push("disconnect");
			return true;
		}),
	};
	const service = createAgentEnrollmentService(persistence, disconnectPort);

	await expect(service.rotateRemoteAgentToken("org-1", "agent-1")).resolves.toBe(rotation);
	expect(order).toEqual(["rotate", "disconnect"]);
	order.length = 0;
	await expect(service.revokeRemoteAgentToken("org-1", "agent-1")).resolves.toBe(revoked);
	expect(order).toEqual(["revoke", "disconnect"]);
});

test("a disconnect rejection cannot discard a committed one-time token or leak it in logs", async () => {
	const persistence = {
		createRemoteAgent: vi.fn(),
		rotateRemoteAgentToken: vi.fn().mockResolvedValue(rotation),
		revokeRemoteAgentToken: vi.fn().mockResolvedValue(revoked),
	};
	const disconnectError = new Error(rotation.token);
	const disconnectPort = { disconnectAgent: vi.fn().mockRejectedValue(disconnectError) };
	const warn = vi.spyOn(logger, "warn").mockImplementation(() => undefined);
	const service = createAgentEnrollmentService(persistence, disconnectPort);

	await expect(service.rotateRemoteAgentToken("org-1", "agent-1")).resolves.toBe(rotation);
	expect(persistence.rotateRemoteAgentToken).toHaveBeenCalledOnce();
	expect(disconnectPort.disconnectAgent).toHaveBeenCalledWith("agent-1");
	expect(warn).toHaveBeenCalledOnce();
	expect(JSON.stringify(warn.mock.calls)).not.toContain(rotation.token);
});

test.each([false, true])(
	"preserves committed rotation and revocation when disconnect returns %s",
	async (disconnected) => {
		const persistence = {
			createRemoteAgent: vi.fn(),
			rotateRemoteAgentToken: vi.fn().mockResolvedValue(rotation),
			revokeRemoteAgentToken: vi.fn().mockResolvedValue(revoked),
		};
		const disconnectPort = { disconnectAgent: vi.fn().mockResolvedValue(disconnected) };
		const service = createAgentEnrollmentService(persistence, disconnectPort);

		await expect(service.rotateRemoteAgentToken("org-1", "agent-1")).resolves.toBe(rotation);
		await expect(service.revokeRemoteAgentToken("org-1", "agent-1")).resolves.toBe(revoked);
		expect(disconnectPort.disconnectAgent).toHaveBeenCalledTimes(2);
	},
);

test("a disconnect rejection cannot change a committed revocation response", async () => {
	const persistence = {
		createRemoteAgent: vi.fn(),
		rotateRemoteAgentToken: vi.fn().mockResolvedValue(rotation),
		revokeRemoteAgentToken: vi.fn().mockResolvedValue(revoked),
	};
	const disconnectPort = { disconnectAgent: vi.fn().mockRejectedValue(new Error("controller unavailable")) };
	vi.spyOn(logger, "warn").mockImplementation(() => undefined);
	const service = createAgentEnrollmentService(persistence, disconnectPort);

	await expect(service.revokeRemoteAgentToken("org-1", "agent-1")).resolves.toBe(revoked);
	expect(persistence.revokeRemoteAgentToken).toHaveBeenCalledOnce();
});
