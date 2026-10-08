import { logger } from "@zerobyte/core/node";
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { createApp } from "~/server/app";
import {
	createTestSession,
	createTestSessionWithOrgAdmin,
	createTestSessionWithRegularMember,
} from "~/test/helpers/auth";
import { agentsService } from "../agents.service";
import { agentManager } from "../agents-manager";
import { validateRemoteAgentToken } from "../helpers/tokens";

const app = createApp();
let owner: Awaited<ReturnType<typeof createTestSession>>;
let admin: Awaited<ReturnType<typeof createTestSessionWithOrgAdmin>>;
let member: Awaited<ReturnType<typeof createTestSessionWithRegularMember>>;

afterEach(() => {
	vi.restoreAllMocks();
});

beforeAll(async () => {
	owner = await createTestSession();
	admin = await createTestSessionWithOrgAdmin();
	member = await createTestSessionWithRegularMember();
});

describe("remote agent enrollment API", () => {
	test("requires a browser-session organization administrator", async () => {
		const unauthenticated = await app.request("/api/v1/agents");
		expect(unauthenticated.status).toBe(401);

		const forbidden = await app.request("/api/v1/agents", { headers: member.headers });
		expect(forbidden.status).toBe(403);
	});

	test("returns the enrollment token once and never leaks its hash through listing", async () => {
		const created = await app.request("/api/v1/agents", {
			method: "POST",
			headers: { ...owner.headers, "content-type": "application/json" },
			body: JSON.stringify({ name: "API agent" }),
		});
		expect(created.status).toBe(201);
		const enrollment = await created.json();
		expect(enrollment.token).toMatch(/^zba1\./);
		expect(JSON.stringify(enrollment)).not.toContain("credentialHash");

		const listed = await app.request("/api/v1/agents", { headers: owner.headers });
		expect(listed.status).toBe(200);
		const agents = await listed.json();
		expect(agents).toEqual(expect.arrayContaining([expect.objectContaining({ id: enrollment.agent.id })]));
		expect(JSON.stringify(agents)).not.toContain(enrollment.token);
		expect(JSON.stringify(agents)).not.toContain("credentialHash");
	});

	test.each(["line\nbreak", "right-to-left\u202eoverride"])(
		"rejects machine names containing Unicode control characters: %j",
		async (name) => {
			const response = await app.request("/api/v1/agents", {
				method: "POST",
				headers: { ...owner.headers, "content-type": "application/json" },
				body: JSON.stringify({ name }),
			});

			expect(response.status).toBe(400);
		},
	);

	test("returns 404 for cross-organization and local token mutations", async () => {
		const created = await app.request("/api/v1/agents", {
			method: "POST",
			headers: { ...owner.headers, "content-type": "application/json" },
			body: JSON.stringify({ name: "Scoped agent" }),
		});
		const enrollment = await created.json();
		const crossOrganization = await app.request(`/api/v1/agents/${enrollment.agent.id}/token/rotate`, {
			method: "POST",
			headers: admin.headers,
		});
		expect(crossOrganization.status).toBe(404);

		const localMutation = await app.request("/api/v1/agents/local/token", {
			method: "DELETE",
			headers: owner.headers,
		});
		expect(localMutation.status).toBe(404);
	});

	test("preserves committed rotation and revocation when runtime disconnect rejects", async () => {
		const created = await app.request("/api/v1/agents", {
			method: "POST",
			headers: { ...owner.headers, "content-type": "application/json" },
			body: JSON.stringify({ name: "Disconnect failure agent" }),
		});
		const enrollment = await created.json();
		vi.spyOn(agentManager, "disconnectAgent").mockRejectedValue(new Error("runtime unavailable"));
		const warn = vi.spyOn(logger, "warn").mockImplementation(() => undefined);

		const response = await app.request(`/api/v1/agents/${enrollment.agent.id}/token/rotate`, {
			method: "POST",
			headers: owner.headers,
		});
		const rotation = await response.json();

		expect(response.status).toBe(200);
		expect(rotation.token).toMatch(/^zba1\./);
		expect(await validateRemoteAgentToken(enrollment.token)).toBeNull();
		expect(await validateRemoteAgentToken(rotation.token)).toBeNull();
		const machine = await agentsService.exchangeEnrollmentToken(rotation.token);
		expect(await validateRemoteAgentToken(machine.token)).toMatchObject({ agentId: enrollment.agent.id });

		const revocation = await app.request(`/api/v1/agents/${enrollment.agent.id}/token`, {
			method: "DELETE",
			headers: owner.headers,
		});

		expect(revocation.status).toBe(200);
		expect(await validateRemoteAgentToken(rotation.token)).toBeNull();
		expect(warn).toHaveBeenCalledTimes(2);
		expect(JSON.stringify(warn.mock.calls)).not.toContain(enrollment.token);
		expect(JSON.stringify(warn.mock.calls)).not.toContain(rotation.token);
	});
});
test("enrollment requires TLS, consumes the code once, and needs no browser session", async () => {
	const enrollment = await agentsService.createRemoteAgent(owner.organizationId, "CLI");
	const options = {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ code: enrollment.token }),
	};
	expect((await app.request("http://localhost/api/v1/agents/enroll", options)).status).toBe(426);
	const response = await app.request("https://localhost/api/v1/agents/enroll", options);
	expect(response.status).toBe(200);
	expect(response.headers.get("cache-control")).toBe("no-store");
	const credential = await response.json();
	expect(await validateRemoteAgentToken(credential.token)).toMatchObject({ agentId: enrollment.agent.id });
	expect((await app.request("https://localhost/api/v1/agents/enroll", options)).status).toBe(401);
});
