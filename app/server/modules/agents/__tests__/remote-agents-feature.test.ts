import { afterEach, expect, test, vi } from "vitest";
import { fromPartial } from "@total-typescript/shoehorn";
import type { BackupRunPayload } from "@zerobyte/contracts/agent-protocol";
import { config } from "~/server/core/config";
import { resolvePermissions, withContext } from "~/server/core/request-context";
import { createApp } from "~/server/app";
import { createTestSession } from "~/test/helpers/auth";
import { createTestVolume } from "~/test/helpers/volume";
import { createTrustedFilesystemSource } from "../../volumes/__tests__/trusted-filesystem-source.fixture";
import { volumeService } from "../../volumes/volume.service";
import { agentsService } from "../agents.service";
import { agentManager } from "../agents-manager";
import { createAgentControllerListener } from "../controller/listener";
import { deriveLocalAgentToken } from "../helpers/tokens";

const app = createApp();
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
		const remote = await volumeService.toPresentedVolume(volume);
		expect(remote.sourceLocation?.availability).toBe("disabled");
		expect(remote.sourceLocation?.root.id).toBe(volume.trustedRootId);
		expect(remote.sourceLocation?.relativePath).toBe(volume.relativePath);
	});

	const response = await app.request("/api/v1/volumes", { headers: session.headers });
	expect(response.status).toBe(200);
	expect(await response.json()).toEqual(
		expect.arrayContaining([
			expect.objectContaining({
				id: volume.id,
				sourceLocation: expect.objectContaining({ availability: "disabled" }),
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
		error: new Error("Remote agents are disabled on this instance."),
	});
	await expect(
		agentManager.runFilesystemCommand("remote-machine", "org", {
			name: "filesystem.browse",
			source: { rootId: "photos", relativePath: "" },
		}),
	).rejects.toThrow("Remote agents are disabled");
});

test("development remote connections are disabled while the private local socket still connects", async () => {
	config.environment = "development";
	config.flags.enableRemoteAgents = false;
	const localToken = await deriveLocalAgentToken();
	const listener = createAgentControllerListener({
		isRunning: () => true,
		onOpen: async (data, transport) => {
			transport.send(data.agentKind);
		},
		onMessage: async () => {},
		onClose: async () => {},
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
