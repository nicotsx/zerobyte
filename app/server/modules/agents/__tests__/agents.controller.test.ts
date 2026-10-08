import { eq } from "drizzle-orm";
import { db } from "~/server/db/db";
import { agentsTable } from "~/server/db/schema";
import { config } from "~/server/core/config";
import { resolvePermissions, withContext } from "~/server/core/request-context";
import { agentManager } from "../agents-manager";
import { createAgentControllerListener } from "../controller/listener";
import { deriveLocalAgentToken } from "../helpers/tokens";
import type { BackupRunPayload } from "@zerobyte/contracts/agent-protocol";
import { createAgentBody } from "../agents.dto";
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { createApp } from "~/server/app";
import {
	createTestSession,
	createTestSessionWithOrgAdmin,
	createTestSessionWithRegularMember,
} from "~/test/helpers/auth";
import { agentsService } from "../agents.service";
import { fromPartial } from "@total-typescript/shoehorn";
import { Effect } from "effect";
import { getAgentRuntimeState } from "../helpers/runtime-state";
import { validateRemoteAgentToken } from "../helpers/tokens";

import { createTestVolume } from "~/test/helpers/volume";
import { createTrustedFilesystemSource } from "../../volumes/__tests__/trusted-filesystem-source.fixture";
import { volumeService } from "../../volumes/volume.service";

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

	test("projects only safe, recognized capabilities in machine responses", async () => {
		const enrollment = await agentsService.createRemoteAgent(owner.organizationId, "Projection agent");
		const capabilities = {
			hostname: "  archive-node  ",
			platform: "linux",
			privatePath: "/srv/private",
			trustedRoots: [{ id: "documents", label: "~/private", canBackup: true, path: "/srv/documents" }],
		};
		await db.update(agentsTable).set({ capabilities }).where(eq(agentsTable.id, enrollment.agent.id));

		const listed = await app.request("/api/v1/agents", { headers: owner.headers });
		const agents = await listed.json();
		const agent = agents.find((candidate: { id: string }) => candidate.id === enrollment.agent.id);
		const expectedCapabilities = {
			hostname: "archive-node",
			platform: "linux",
			trustedRoots: [{ id: "documents", label: "Allowed location", canBackup: true }],
		};
		expect(agent?.capabilities).toEqual(expectedCapabilities);
		expect(JSON.stringify(agent)).not.toContain("/srv/private");
		expect(JSON.stringify(agent)).not.toContain("/srv/documents");

		await db.update(agentsTable).set({ capabilities: {} }).where(eq(agentsTable.id, enrollment.agent.id));

		const relisted = await app.request("/api/v1/agents", { headers: owner.headers });
		const relistedAgents = await relisted.json();
		const unenrolledAgent = relistedAgents.find(
			(candidate: { id: string }) => candidate.id === enrollment.agent.id,
		);
		expect(unenrolledAgent?.capabilities).toEqual({ hostname: null, platform: null, trustedRoots: [] });
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

	test.each([true, false])(
		"preserves committed rotation and revocation when disconnect returns %s",
		async (disconnected) => {
			const created = await app.request("/api/v1/agents", {
				method: "POST",
				headers: { ...owner.headers, "content-type": "application/json" },
				body: JSON.stringify({ name: "Disconnect failure agent" }),
			});

			const enrollment = await created.json();

			const runtimeState = getAgentRuntimeState();
			const originalController = runtimeState.controller;

			const committedVersions: number[] = [];

			runtimeState.controller = fromPartial({
				disconnect: (agentId: string) =>
					Effect.promise(async () => {
						const stored = await agentsService.getAgent(agentId);

						committedVersions.push(stored!.credentialVersion);
						return disconnected;
					}),
			});

			try {
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

				const revoked = await revocation.json();

				expect(revocation.status).toBe(200);
				expect(committedVersions).toEqual([rotation.agent.credentialVersion, revoked.credentialVersion]);
				expect(await validateRemoteAgentToken(rotation.token)).toBeNull();
			} finally {
				runtimeState.controller = originalController;
			}
		},
	);
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

describe("createAgentBody", () => {
	test("trims valid machine names and preserves the length boundary", () => {
		const maximumLengthName = "a".repeat(100);
		const parsedName = createAgentBody.parse({ name: `  ${maximumLengthName}  ` }).name;

		expect(parsedName).toBe(maximumLengthName);
	});

	test.each(["archive\u0000node", "archive\u202enode", "\narchive"])(
		"rejects Unicode Cc/Cf characters in %j",
		(name) => {
			expect(createAgentBody.safeParse({ name }).success).toBe(false);
		},
	);
});

describe("Remote-agent feature flag", () => {
	const originalRuntime = config.runtime;
	const originalEnvironment = config.environment;
	const originalFlag = config.flags.enableRemoteAgents;

	afterEach(() => {
		config.runtime = originalRuntime;
		config.environment = originalEnvironment;
		config.flags.enableRemoteAgents = originalFlag;
		vi.restoreAllMocks();
	});

	test.each([
		["server", false, false],
		["server", true, true],
		["desktop", false, false],
		["desktop", true, false],
	] as const)("remote-agent permissions follow runtime %s and flag %s", (runtime, enabled, expected) => {
		config.runtime = runtime;
		config.flags.enableRemoteAgents = enabled;

		const permissions = resolvePermissions({ orgRole: "owner", authSource: "browser-session" });

		expect(permissions.features.remoteAgents).toBe(expected);
		expect(permissions.permissions["agents.manage"]).toBe(expected);
	});

	test("disabled remote APIs preserve enrollment and machine configuration", async () => {
		const session = await createTestSession();
		const enrollment = await agentsService.createRemoteAgent(session.organizationId, "Pilot machine");
		const original = await agentsService.getAgent(enrollment.agent.id);

		config.flags.enableRemoteAgents = false;

		const requests = [
			{ path: "/api/v1/agents", method: "GET" },
			{ path: "/api/v1/agents", method: "POST", body: { name: "Blocked machine" } },
			{ path: `/api/v1/agents/${enrollment.agent.id}/token/rotate`, method: "POST" },
			{ path: `/api/v1/agents/${enrollment.agent.id}/token`, method: "DELETE" },
			{ path: `/api/v1/agents/${enrollment.agent.id}`, method: "DELETE" },
			{ path: "/api/v1/agents/enroll", method: "POST", body: { code: enrollment.token } },
			{ path: "/api/v1/agents/download", method: "GET" },
			{ path: "/api/v1/volumes/source-machines", method: "GET" },
			{ path: `/api/v1/volumes/filesystem/browse?agentId=${enrollment.agent.id}&rootId=photos`, method: "GET" },
			{
				path: "/api/v1/volumes",
				method: "POST",
				body: {
					name: "Blocked source",
					sourceKind: "filesystem",
					agentId: enrollment.agent.id,
					trustedRootId: "photos",
					relativePath: "",
				},
			},
		];

		for (const request of requests) {
			const response = await app.request(request.path, {
				method: request.method,
				headers: { ...session.headers, "content-type": "application/json" },
				body: request.body ? JSON.stringify(request.body) : undefined,
			});

			expect(response.status, `${request.method} ${request.path}`).toBe(503);
			expect(await response.text()).toContain("Remote agents are disabled");
		}

		expect(await agentsService.getAgent(enrollment.agent.id)).toEqual(original);
	});

	test("disabled remote sources remain readable while local sources remain usable", async () => {
		const session = await createTestSession();
		const { volume } = await createTrustedFilesystemSource(session.organizationId);
		const localVolume = await createTestVolume({ organizationId: session.organizationId });
		config.flags.enableRemoteAgents = false;

		await withContext({ organizationId: session.organizationId }, async () => {
			const { volume: remote } = await volumeService.getVolume(volume.shortId);
			expect(remote.trustedRootId).toBe(volume.trustedRootId);
			expect(remote.relativePath).toBe(volume.relativePath);
		});

		const response = await app.request("/api/v1/volumes", { headers: session.headers });
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					id: volume.id,
					sourceKind: "filesystem",
				}),
				expect.objectContaining({ id: localVolume.id, sourceKind: "managed" }),
			]),
		);
	});

	test("disabled remote dispatch refuses saved sources before attempting a connection", async () => {
		config.flags.enableRemoteAgents = false;

		expect(await agentManager.isAgentReady("remote-machine")).toBe(false);

		const result = await agentManager.runBackup("remote-machine", {
			scheduleId: 1,
			payload: fromPartial<BackupRunPayload>({ jobId: "blocked-job", scheduleId: "blocked-schedule" }),
			signal: new AbortController().signal,
			onProgress: () => {},
		});

		expect(result).toMatchObject({
			status: "unavailable",
			error: new Error("Failed to send backup command to agent remote-machine"),
		});

		await expect(
			Effect.runPromise(
				agentManager.runFilesystemCommand("remote-machine", "org", {
					name: "filesystem.browse",
					source: { rootId: "photos", relativePath: "" },
				}),
			),
		).rejects.toThrow("Failed to send filesystem command filesystem.browse to agent remote-machine");
	});

	test("development remote connections are disabled while the private local socket still connects", async () => {
		config.environment = "development";
		config.flags.enableRemoteAgents = false;

		const localToken = await deriveLocalAgentToken();

		const listener = createAgentControllerListener({
			isRunning: () => true,
			socket: {
				open: async (data, transport) => {
					transport.send(data.agentKind);
				},
				message: async () => {},
				close: async () => {},
			},
		});

		try {
			const remote = await fetch(`http://127.0.0.1:${listener.port}/api/v1/agents/connect`, {
				headers: { authorization: "Bearer saved-remote-credential" },
			});

			expect(remote.status).toBe(503);

			const Socket = globalThis.WebSocket as unknown as {
				new (url: string, options: Bun.WebSocketOptions): WebSocket;
			};

			const socket = new Socket(`ws://127.0.0.1:${listener.port}`, {
				headers: { authorization: `Bearer ${localToken}` },
			});

			try {
				const kind = await new Promise<string>((resolve, reject) => {
					socket.onmessage = (event) => resolve(String(event.data));
					socket.onerror = () => reject(new Error("Local agent failed to connect"));
				});

				expect(kind).toBe("local");
			} finally {
				socket.close();
			}
		} finally {
			await listener.stop(true);
		}
	});
});

test("remote machine deletion is scoped and rejects attached sources", async () => {
	const enrollment = await agentsService.createRemoteAgent(owner.organizationId, "Delete candidate");
	const url = `/api/v1/agents/${enrollment.agent.id}`;
	expect((await app.request(url, { method: "DELETE", headers: admin.headers })).status).toBe(404);
	expect((await app.request(url, { method: "DELETE", headers: member.headers })).status).toBe(403);
	expect((await app.request("/api/v1/agents/local", { method: "DELETE", headers: owner.headers })).status).toBe(404);
	await createTestVolume({ organizationId: owner.organizationId, agentId: enrollment.agent.id });
	expect((await app.request(url, { method: "DELETE", headers: owner.headers })).status).toBe(409);
	expect(await db.query.agentsTable.findFirst({ where: { id: enrollment.agent.id } })).toBeDefined();
});

test("deleting a remote machine invalidates credentials and disconnects it", async () => {
	const enrollment = await agentsService.createRemoteAgent(owner.organizationId, "Delete me");
	const credential = await agentsService.exchangeEnrollmentToken(enrollment.token);
	const disconnect = vi.spyOn(agentManager, "disconnectAgent").mockReturnValue(Effect.succeed(true));
	const response = await app.request(`/api/v1/agents/${enrollment.agent.id}`, {
		method: "DELETE",
		headers: owner.headers,
	});
	expect(response.status).toBe(200);
	expect(disconnect).toHaveBeenCalledWith(enrollment.agent.id);
	expect(await validateRemoteAgentToken(credential.token)).toBeNull();
	expect(await db.query.agentsTable.findFirst({ where: { id: enrollment.agent.id } })).toBeUndefined();
});

test("development permits HTTP enrollment", async () => {
	vi.spyOn(config, "environment", "get").mockReturnValue("development");
	const enrollment = await agentsService.createRemoteAgent(owner.organizationId, "Development");
	const response = await app.request("http://localhost/api/v1/agents/enroll", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ code: enrollment.token }),
	});
	expect(response.status).toBe(200);
});
