import { Effect } from "effect";
import { afterEach, beforeEach, vi } from "vitest";
import { fromPartial } from "@total-typescript/shoehorn";
import type { Volume } from "@zerobyte/contracts/volumes";
import { LOCAL_AGENT_ID, LOCAL_AGENT_KIND, LOCAL_AGENT_NAME } from "../constants";

const agentsServiceMocks = vi.hoisted(() => ({
	markAgentConnecting: vi.fn(() => Promise.resolve()),
	markAgentOnline: vi.fn(() => Promise.resolve()),
	markAgentSeen: vi.fn(() => Promise.resolve()),
	markAgentOffline: vi.fn(() => Promise.resolve()),
}));

const tokenMocks = vi.hoisted(() => ({
	validateAgentToken: vi.fn(),
}));

vi.mock("../agents.service", () => ({
	agentsService: agentsServiceMocks,
}));

vi.mock("../helpers/tokens", () => ({
	validateAgentToken: tokenMocks.validateAgentToken,
}));

export const createSocket = (id: string, agentId = LOCAL_AGENT_ID) => ({
	data: {
		id,
		agentId,
		organizationId: null,
		agentName: agentId === LOCAL_AGENT_ID ? LOCAL_AGENT_NAME : `${LOCAL_AGENT_NAME} ${agentId}`,
		agentKind: LOCAL_AGENT_KIND,
		credentialVersion: 0,
	},
	send: vi.fn((_message: string) => 1),
	close: vi.fn(),
});

export const backupVolume = {
	id: 1,
	shortId: "volume-1",
	name: "Volume 1",
	config: { backend: "directory", path: "/tmp" },
	createdAt: 0,
	updatedAt: 0,
	lastHealthCheck: 0,
	type: "directory",
	status: "mounted" as const,
	lastError: null,
	autoRemount: true,
	agentId: LOCAL_AGENT_ID,
	organizationId: "org-1",
	sourceKind: "managed" as const,
	trustedRootId: null,
	relativePath: null,
} satisfies Volume;

export const readyPayload = {
	agentId: LOCAL_AGENT_ID,
	protocolVersion: 1,
	hostname: "host",
	platform: "linux",
	capabilities: { backup: true, restore: true, volume: true },
};

export const backupPayload = {
	jobId: "job-1",
	scheduleId: "schedule-1",
	organizationId: "org-1",
	source: { kind: "managed" as const, volume: backupVolume },
	repositoryConfig: { backend: "local" as const, path: "/tmp/repository" },
	options: {
		oneFileSystem: false,
		excludePatterns: null,
		excludeIfPresent: null,
		includePaths: null,
		includePatterns: null,
		customResticParams: null,
		compressionMode: "auto" as const,
	},
	runtime: { password: "password" },
	webhooks: { pre: null, post: null },
	webhookAllowedOrigins: [],
	webhookTimeoutMs: 60_000,
};

type CapturedFetch = NonNullable<Parameters<typeof Bun.serve>[0]["fetch"]>;

export const invokeFetch = (fetch: CapturedFetch | undefined, request: Request, srv: Parameters<CapturedFetch>[1]) => {
	if (!fetch) throw new Error("Bun.serve was not called with a fetch handler");
	return Reflect.apply(fetch, fromPartial<ThisParameterType<CapturedFetch>>({}), [
		request,
		srv,
	]) as ReturnType<CapturedFetch>;
};

export const startRuntime = async (onEvent = vi.fn()) => {
	const { createAgentManagerRuntime } = await import("../controller/server");
	const runtime = createAgentManagerRuntime(onEvent);
	await Effect.runPromise(runtime.start);
	return { runtime, onEvent };
};

export const getAgentsServiceMocks = () => agentsServiceMocks;
export const getTokenMocks = () => tokenMocks;

beforeEach(() => {
	agentsServiceMocks.markAgentConnecting.mockReset().mockResolvedValue(undefined);
	agentsServiceMocks.markAgentOnline.mockReset().mockResolvedValue(undefined);
	agentsServiceMocks.markAgentSeen.mockReset().mockResolvedValue(undefined);
	agentsServiceMocks.markAgentOffline.mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
	vi.restoreAllMocks();
	tokenMocks.validateAgentToken.mockReset();
	vi.resetModules();
});
