import { eq, sql } from "drizzle-orm";
import { Effect, Stream } from "effect";
import { afterEach, beforeAll, beforeEach, expect, test, vi } from "vitest";
import {
	AGENT_PROTOCOL_VERSION,
	SUPPORTED_AGENT_PROTOCOL_MAX_VERSION,
	SUPPORTED_AGENT_PROTOCOL_MIN_VERSION,
} from "@zerobyte/contracts/agent-protocol";
import { AGENT_MAINTENANCE_PATH } from "@zerobyte/contracts/agent-maintenance";
import {
	AGENT_RELEASE_ATTESTATION_ASSET,
	AGENT_RELEASE_ATTESTATION_MAX_BYTES,
	AgentAttestationInvalid,
	agentReleaseAssetUrl,
	agentReleaseManifestSchema,
} from "@zerobyte/contracts/agent-release";
import { streamAgentReleaseAsset } from "@zerobyte/contracts/agent-release-download";
import { createApp } from "~/server/app";
import * as agentManagerModule from "../agents-manager";
import { db } from "~/server/db/db";
import { agentsTable, member as members } from "~/server/db/schema";
import { auth } from "~/server/lib/auth";
import connectRoute from "~/nitro/routes/api/v1/agents/connect";
import { config } from "~/server/core/config";
import {
	createTestSession,
	createTestSessionWithOrgAdmin,
	createTestSessionWithRegularMember,
} from "~/test/helpers/auth";
import { getAgentUpdateRelease } from "../agent-update-release";
import { agentUpdates } from "../agent-updates";
import { agentsService } from "../agents.service";
import { createAgentController } from "../controller/server";
import { getAgentRuntimeState } from "../helpers/runtime-state";
import { validateRemoteAgentToken } from "../helpers/tokens";

vi.mock("@zerobyte/contracts/agent-release", async (importOriginal) => ({
	...(await importOriginal<typeof import("@zerobyte/contracts/agent-release")>()),
	verifyAgentReleaseAttestation: (bytes: Uint8Array, tag: string) =>
		Effect.try({
			try: () => {
				const release = agentReleaseManifestSchema.parse(JSON.parse(new TextDecoder().decode(bytes)));
				if (release.tag !== tag) throw new Error("Attestation tag does not match");
				return release;
			},
			catch: (cause) => new AgentAttestationInvalid({ cause }),
		}),
}));

const app = createApp();
const originalVersion = config.appVersion;

let owner: Awaited<ReturnType<typeof createTestSession>>;
let outsider: Awaited<ReturnType<typeof createTestSessionWithOrgAdmin>>;
let member: Awaited<ReturnType<typeof createTestSessionWithRegularMember>>;

beforeAll(async () => {
	owner = await createTestSession();
	outsider = await createTestSessionWithOrgAdmin();
	member = await createTestSessionWithRegularMember();
});

beforeEach(() => {
	config.appVersion = "v1.4.0";
});

afterEach(() => {
	config.appVersion = originalVersion;
	vi.restoreAllMocks();
});

const serveRelease = (protocolVersion = AGENT_PROTOCOL_VERSION, signed = true, hash = "a") => {
	const release = {
		formatVersion: 1 as const,
		tag: config.appVersion,
		protocolVersion,
		sha256: { x64: hash.repeat(64), arm64: "b".repeat(64) },
	};
	const bundle = signed ? JSON.stringify(release) : "unverified";

	const fetchRelease = vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
		const asset = new URL(url instanceof Request ? url.url : url);
		expect(asset.origin + asset.pathname.slice(0, asset.pathname.lastIndexOf("/"))).toBe(
			`https://zerobyte.app/agent/${release.tag}`,
		);
		expect(asset.pathname.split("/").at(-1)).toBe(AGENT_RELEASE_ATTESTATION_ASSET);
		return new Response(bundle);
	});

	return { release, fetchRelease };
};

const prepareAgent = async (protocolVersion: number | undefined, version = "1.3.0", selfUpdate?: "systemd") => {
	const enrollment = await agentsService.createRemoteAgent(owner.organizationId, Bun.randomUUIDv7());
	const { token } = await agentsService.exchangeEnrollmentToken(enrollment.token);
	const identity = (await validateRemoteAgentToken(token))!;
	await agentsService.markAgentOnline(identity, {
		agentVersion: version,
		protocolVersion,
		platform: "linux",
		selfUpdate,
		connectionSecurity: "secure",
	});
	await agentsService.markAgentOffline(identity);

	return { identity, token, enrollment };
};

const queue = (agentId: string, headers = owner.headers, targetTag = config.appVersion, signal?: AbortSignal) =>
	app.request(`/api/v1/agents/${agentId}/update`, {
		method: "POST",
		headers: { ...headers, "content-type": "application/json" },
		body: JSON.stringify({ targetTag }),
		signal,
	});

const maintenance = (token: string, body: object = { action: "poll" }, scheme = "https") =>
	app.request(`${scheme}://localhost${AGENT_MAINTENANCE_PATH}`, {
		method: "POST",
		headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
		body: JSON.stringify(body),
	});

test("queues a verified exact target and delivers it offline, fencing attempts and credentials", async () => {
	const { release, fetchRelease } = serveRelease();
	const { identity, token, enrollment } = await prepareAgent(
		SUPPORTED_AGENT_PROTOCOL_MIN_VERSION - 1,
		"1.3.0",
		"systemd",
	);

	expect((await queue(identity.agentId, outsider.headers)).status).toBe(404);
	expect((await queue(identity.agentId, member.headers)).status).toBe(403);
	expect((await queue(identity.agentId, owner.headers, "v1.5.0")).status).toBe(409);
	expect(fetchRelease).not.toHaveBeenCalled();
	expect((await maintenance(enrollment.token)).status).toBe(401);
	expect((await maintenance(token, { action: "poll" }, "http")).status).toBe(426);
	expect((await maintenance(token, { action: "poll", extra: "a".repeat(513) })).status).toBe(413);

	const [first, second] = await Promise.all([queue(identity.agentId), queue(identity.agentId)]);
	expect(first.status).toBe(200);
	expect(second.status).toBe(200);
	const queued = await first.json();
	expect(await second.json()).toEqual(queued);
	expect(queued).toMatchObject({ availability: "required", delivery: "remote", request: { status: "queued" } });
	expect(fetchRelease).toHaveBeenCalledOnce();
	expect(await (await maintenance(token)).json()).toEqual({
		update: { requestId: queued.request.id, status: "queued", target: release },
	});

	const attempt = { action: "start", requestId: queued.request.id, attemptId: Bun.randomUUIDv7() };
	expect(await (await maintenance(token, attempt)).json()).toMatchObject({ update: { status: "started" } });
	expect((await maintenance(token, attempt)).status).toBe(200);
	expect((await maintenance(token, { ...attempt, attemptId: Bun.randomUUIDv7() })).status).toBe(409);
	expect((await agentsService.getAgent(identity.agentId))?.updateRequest?.status).toBe("started");
	const failure = { ...attempt, action: "fail" };
	expect(await (await maintenance(token, failure)).json()).toEqual({ update: null });
	expect((await maintenance(token, failure)).status).toBe(200);
	const stored = db
		.select({ update: sql<string>`${agentsTable.updateRequest}` })
		.from(agentsTable)
		.where(eq(agentsTable.id, identity.agentId))
		.get();
	expect(JSON.parse(stored!.update)).toEqual({
		requestId: attempt.requestId,
		attemptId: attempt.attemptId,
		requestedAt: queued.request.requestedAt,
		target: release,
		status: "failed",
	});

	const retry = await (await queue(identity.agentId)).json();
	expect(retry.request.id).not.toBe(attempt.requestId);
	expect((await maintenance(token, failure)).status).toBe(200);
	await agentsService.markAgentOnline(identity, {
		agentVersion: "1.3.0",
		protocolVersion: AGENT_PROTOCOL_VERSION,
		platform: "linux",
		selfUpdate: "systemd",
		connectionSecurity: "secure",
	});
	expect((await agentsService.getAgent(identity.agentId))?.updateRequest?.status).toBe("queued");
	await agentsService.markAgentOnline(identity, {
		agentVersion: release.tag,
		protocolVersion: release.protocolVersion,
	});
	expect((await agentsService.getAgent(identity.agentId))?.updateRequest?.status).toBe("completed");
	expect(await (await maintenance(token)).json()).toEqual({ update: null });

	await agentsService.rotateRemoteAgentToken(owner.organizationId, identity.agentId);
	expect((await maintenance(token)).status).toBe(401);
	expect(() => agentUpdates.maintainAgent(identity, { action: "poll" })).toThrow("Invalid agent credential");
});

test.each([
	{ failure: null, version: "v1.25.0" },
	{ failure: "signature", version: "v1.26.0" },
	{ failure: "size", version: "v1.27.0" },
	{ failure: "redirect", version: "v1.28.0" },
])("fetches official redirects with release validation (failure: $failure)", async ({ failure, version }) => {
	config.appVersion = version;
	const { release, fetchRelease } = serveRelease(AGENT_PROTOCOL_VERSION, failure !== "signature");
	const serveAsset = fetchRelease.getMockImplementation()!;
	const { identity, token } = await prepareAgent(AGENT_PROTOCOL_VERSION, "1.3.0", "systemd");

	let signal: AbortSignal | undefined;
	fetchRelease.mockImplementation(async (url, options) => {
		const asset = new URL(url instanceof Request ? url.url : url);
		const assetName = asset.pathname.split("/").at(-1)!;
		expect(options).toMatchObject({ redirect: "manual", tls: { rejectUnauthorized: true } });
		expect(assetName).toBe(AGENT_RELEASE_ATTESTATION_ASSET);
		signal ??= options!.signal!;
		expect(options?.signal).toBe(signal);

		if (asset.hostname === "zerobyte.app") {
			expect(asset.pathname).toBe(`/agent/${version}/${assetName}`);
			return Response.redirect(
				`https://github.com/nicotsx/zerobyte/releases/download/${version}/${assetName}`,
				302,
			);
		}

		if (asset.hostname === "github.com") {
			expect(asset.pathname).toBe(`/nicotsx/zerobyte/releases/download/${version}/${assetName}`);
			if (failure === "redirect") return Response.redirect(`https://example.com/${assetName}`, 302);
			return Response.redirect(`https://release-assets.githubusercontent.com/${assetName}?asset=1`, 302);
		}

		expect(asset.hostname).toBe("release-assets.githubusercontent.com");
		if (failure === "size") {
			return new Response(new Uint8Array(AGENT_RELEASE_ATTESTATION_MAX_BYTES + 1));
		}
		return serveAsset(new URL(`https://zerobyte.app/agent/${version}/${assetName}`));
	});

	const response = await queue(identity.agentId);
	expect(fetchRelease).toHaveBeenCalledTimes(failure === "redirect" ? 2 : 3);

	if (failure) {
		expect(response.status).toBe(503);
		expect(await (await maintenance(token)).json()).toEqual({ update: null });
	} else {
		expect(response.status).toBe(200);
		expect(await (await maintenance(token)).json()).toMatchObject({
			update: { target: release, status: "queued" },
		});
	}
});

test.each([404, 502])("shares an attestation lookup and temporarily caches HTTP %i", async (status) => {
	config.appVersion = status === 404 ? "v1.31.0" : "v1.37.0";
	const { release, fetchRelease } = serveRelease();
	const serveAsset = fetchRelease.getMockImplementation()!;
	const now = Date.now();
	const clock = vi.spyOn(Date, "now").mockReturnValue(now);
	const response = Promise.withResolvers<Response>();
	fetchRelease.mockImplementation(() => response.promise);

	const first = Effect.runPromise(getAgentUpdateRelease(release.tag));
	const concurrent = Effect.runPromise(getAgentUpdateRelease(release.tag));
	await vi.waitFor(() => expect(fetchRelease).toHaveBeenCalledOnce());
	clock.mockReturnValue(now + 1_000);
	response.resolve(new Response(null, { status }));
	expect(await Promise.all([first, concurrent])).toEqual([null, null]);
	expect(fetchRelease).toHaveBeenCalledOnce();

	fetchRelease.mockImplementation(serveAsset);
	clock.mockReturnValue(now + 5_999);
	expect(await Effect.runPromise(getAgentUpdateRelease(release.tag))).toBeNull();
	expect(fetchRelease).toHaveBeenCalledOnce();

	clock.mockReturnValue(now + 6_000);
	expect(await Effect.runPromise(getAgentUpdateRelease(release.tag))).toEqual(release);
	expect(fetchRelease).toHaveBeenCalledTimes(2);

	clock.mockReturnValue(now + 6_000 + 59_999);
	expect(await Effect.runPromise(getAgentUpdateRelease(release.tag))).toEqual(release);
	expect(fetchRelease).toHaveBeenCalledTimes(2);

	clock.mockReturnValue(now + 6_000 + 60_000);
	expect(await Effect.runPromise(getAgentUpdateRelease(release.tag))).toEqual(release);
	expect(fetchRelease).toHaveBeenCalledTimes(3);
});

test("aborting a queue request leaves a shared release lookup running for another caller", async () => {
	config.appVersion = "v1.38.0";
	const { release, fetchRelease } = serveRelease();
	const serveAsset = fetchRelease.getMockImplementation()!;
	const { identity } = await prepareAgent(AGENT_PROTOCOL_VERSION, "1.3.0", "systemd");

	const download = Promise.withResolvers<void>();
	const started = Promise.withResolvers<AbortSignal>();
	fetchRelease.mockImplementation(async (url, options) => {
		started.resolve(options!.signal!);
		await download.promise;
		return serveAsset(url, options);
	});

	const caller = new AbortController();
	const abandoned = queue(identity.agentId, owner.headers, release.tag, caller.signal);
	const downloadSignal = await started.promise;
	const concurrent = Effect.runPromise(getAgentUpdateRelease(release.tag));

	caller.abort();
	await abandoned;
	expect(downloadSignal.aborted).toBe(false);
	expect((await agentsService.getAgent(identity.agentId))?.updateRequest).toBeNull();

	download.resolve();
	expect(await concurrent).toEqual(release);
	expect(fetchRelease).toHaveBeenCalledOnce();
});

test("an already cancelled queue request does not write when the release is cached", async () => {
	config.appVersion = "v1.39.0";
	const { release, fetchRelease } = serveRelease();
	const { identity } = await prepareAgent(AGENT_PROTOCOL_VERSION, "1.3.0", "systemd");

	expect(await Effect.runPromise(getAgentUpdateRelease(release.tag))).toEqual(release);

	const response = await queue(identity.agentId, owner.headers, release.tag, AbortSignal.abort());
	expect(response.ok).toBe(false);
	expect((await agentsService.getAgent(identity.agentId))?.updateRequest).toBeNull();
	expect(fetchRelease).toHaveBeenCalledOnce();
});

test("releases the body when the caller interrupts during reader acquisition", async () => {
	const caller = new AbortController();
	const cancel = vi.fn();
	const body = new ReadableStream<Uint8Array>({ cancel });
	const getReader = body.getReader.bind(body);

	vi.spyOn(body, "getReader").mockImplementation(() => {
		const reader = getReader();
		caller.abort();
		return reader;
	});
	vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(body));

	const url = agentReleaseAssetUrl("v1.39.0", AGENT_RELEASE_ATTESTATION_ASSET);
	const result = await Effect.runPromiseExit(Stream.runDrain(streamAgentReleaseAsset(url, 64)), {
		signal: caller.signal,
	});

	expect(result._tag).toBe("Failure");
	expect(cancel).toHaveBeenCalledOnce();
	expect(body.locked).toBe(false);
});

test.each([200, 302])("cleans up a late attestation response with status %i after interruption", async (status) => {
	const tag = status === 200 ? "v1.33.0" : "v1.34.0";
	const response = Promise.withResolvers<Response>();
	const started = Promise.withResolvers<AbortSignal>();
	const caller = new AbortController();
	const cancel = vi.fn(() => new Promise<void>(() => {}));
	const body = new ReadableStream<Uint8Array>({ cancel });
	const fetchRelease = vi.spyOn(globalThis, "fetch").mockImplementation((_url, options) => {
		started.resolve(options!.signal!);
		return response.promise;
	});

	const url = agentReleaseAssetUrl(tag, AGENT_RELEASE_ATTESTATION_ASSET);
	const read = Effect.runPromiseExit(
		Stream.runDrain(streamAgentReleaseAsset(url, AGENT_RELEASE_ATTESTATION_MAX_BYTES)),
		{
			signal: caller.signal,
		},
	);
	const downloadSignal = await started.promise;
	caller.abort();
	expect((await read)._tag).toBe("Failure");
	expect(downloadSignal.aborted).toBe(true);

	response.resolve(
		new Response(body, {
			status,
			headers: {
				location: `https://github.com/nicotsx/zerobyte/releases/download/${tag}/${AGENT_RELEASE_ATTESTATION_ASSET}`,
			},
		}),
	);
	await vi.waitFor(() => expect(cancel).toHaveBeenCalledOnce());
	expect(fetchRelease).toHaveBeenCalledOnce();
	expect(body.locked).toBe(false);
});

test("caches verification failures for one minute per tag", async () => {
	config.appVersion = "v1.35.0";
	const { release, fetchRelease } = serveRelease(AGENT_PROTOCOL_VERSION, false);
	const now = Date.now();
	const clock = vi.spyOn(Date, "now").mockReturnValue(now);

	expect(await Effect.runPromise(getAgentUpdateRelease(release.tag))).toBeNull();
	expect(fetchRelease).toHaveBeenCalledOnce();

	config.appVersion = "v1.36.0";
	const { release: otherRelease } = serveRelease();
	expect(await Effect.runPromise(getAgentUpdateRelease(otherRelease.tag))).toEqual(otherRelease);
	expect(fetchRelease).toHaveBeenCalledTimes(2);

	config.appVersion = release.tag;
	serveRelease();
	clock.mockReturnValue(now + 59_999);
	expect(await Effect.runPromise(getAgentUpdateRelease(release.tag))).toBeNull();
	expect(fetchRelease).toHaveBeenCalledTimes(2);

	clock.mockReturnValue(now + 60_000);
	expect(await Effect.runPromise(getAgentUpdateRelease(release.tag))).toEqual(release);
	expect(fetchRelease).toHaveBeenCalledTimes(3);
});

test("uses one release download deadline across redirects and body reads", async () => {
	vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });

	try {
		const tag = "v1.32.0";
		const cancelRedirect = vi.fn(() => new Promise<void>(() => {}));
		const cancel = vi.fn();
		const body = new ReadableStream<Uint8Array>({ cancel });
		const fetchRelease = vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
			const asset = new URL(url instanceof Request ? url.url : url);
			if (asset.hostname === "github.com") return new Response(body);

			await new Promise((resolve) => setTimeout(resolve, 2_000));
			return new Response(new ReadableStream({ cancel: cancelRedirect }), {
				status: 302,
				headers: {
					location: `https://github.com/nicotsx/zerobyte/releases/download/${tag}/${AGENT_RELEASE_ATTESTATION_ASSET}`,
				},
			});
		});

		const release = Effect.runPromise(getAgentUpdateRelease(tag));
		await vi.advanceTimersByTimeAsync(2_999);
		expect(fetchRelease).toHaveBeenCalledTimes(2);
		expect(cancelRedirect).toHaveBeenCalledOnce();
		expect(body.locked).toBe(true);

		await vi.advanceTimersByTimeAsync(1);
		expect(await release).toBeNull();
		expect(cancel).toHaveBeenCalledOnce();
		expect(body.locked).toBe(false);
	} finally {
		vi.useRealTimers();
	}
});

test("suppresses offers for unknown and newer protocols and never downgrades", async () => {
	config.appVersion = "v1.5.0";
	serveRelease();

	const scenarios = [
		[AGENT_PROTOCOL_VERSION, "1.3.0", undefined, "available", "manual"],
		[AGENT_PROTOCOL_VERSION, "1.3.0", "systemd", "available", "remote"],
		[SUPPORTED_AGENT_PROTOCOL_MIN_VERSION - 1, "1.3.0", undefined, "required", "manual"],
		[SUPPORTED_AGENT_PROTOCOL_MAX_VERSION + 1, "1.3.0", "systemd", "none", null],
		[undefined, "1.3.0", "systemd", "none", null],
		[AGENT_PROTOCOL_VERSION, "1.5.0", "systemd", "none", null],
		[AGENT_PROTOCOL_VERSION, "1.6.0", "systemd", "none", null],
	] as const;

	for (const [protocol, version, support, availability, delivery] of scenarios) {
		const { identity } = await prepareAgent(protocol, version, support);
		const agents = await Effect.runPromise(agentsService.listOrganizationAgents(owner.organizationId));
		expect(agents.find(({ id }) => id === identity.agentId)?.update).toMatchObject({ availability, delivery });
		if (delivery !== "remote") expect((await queue(identity.agentId)).status).toBe(409);
	}
});

test.each([false, true])("suppresses an unusable signed=%s release", async (signed) => {
	config.appVersion = signed ? "v1.6.0" : "v1.7.0";
	serveRelease(signed ? SUPPORTED_AGENT_PROTOCOL_MAX_VERSION + 1 : AGENT_PROTOCOL_VERSION, signed);
	const { identity } = await prepareAgent(AGENT_PROTOCOL_VERSION, "1.3.0", "systemd");

	expect((await queue(identity.agentId)).status).toBe(503);
	const agents = await Effect.runPromise(agentsService.listOrganizationAgents(owner.organizationId));
	expect(agents.find(({ id }) => id === identity.agentId)?.update.availability).toBe("none");
});

test.each(["dev", "nightly", "v1.9.0-nightly.1"])("does not query an unofficial server version %s", async (version) => {
	config.appVersion = version;
	const { fetchRelease } = serveRelease();
	const { identity } = await prepareAgent(SUPPORTED_AGENT_PROTOCOL_MIN_VERSION - 1, "1.3.0", "systemd");

	expect((await queue(identity.agentId)).status).toBe(409);
	const agents = await Effect.runPromise(agentsService.listOrganizationAgents(owner.organizationId));
	expect(agents.find(({ id }) => id === identity.agentId)?.update).toMatchObject({
		availability: "required",
		delivery: "manual",
		targetTag: null,
	});
	expect(fetchRelease).not.toHaveBeenCalled();
});

test.each(["network", "oversize"])("falls back to manual when the attestation fetch fails with %s", async (failure) => {
	config.appVersion = failure === "network" ? "v1.10.0" : "v1.11.0";
	const fetchRelease = vi.spyOn(globalThis, "fetch");
	if (failure === "network") {
		fetchRelease.mockRejectedValue(new Error("Network unreachable"));
	} else {
		fetchRelease.mockImplementation(async () => {
			const body = new ReadableStream({
				start(controller) {
					controller.enqueue(new Uint8Array(AGENT_RELEASE_ATTESTATION_MAX_BYTES));
					controller.enqueue(new Uint8Array(1));
				},
			});

			return new Response(body);
		});
	}

	const { identity } = await prepareAgent(SUPPORTED_AGENT_PROTOCOL_MIN_VERSION - 1, "1.3.0", "systemd");
	expect((await queue(identity.agentId)).status).toBe(503);
	const agents = await Effect.runPromise(agentsService.listOrganizationAgents(owner.organizationId));
	expect(agents.find(({ id }) => id === identity.agentId)?.update).toMatchObject({
		availability: "required",
		delivery: "manual",
		targetTag: null,
		request: null,
	});
});

test("revocation removes queued delivery and fences an already authenticated caller", async () => {
	config.appVersion = "v1.12.0";
	serveRelease();
	const { identity, token } = await prepareAgent(AGENT_PROTOCOL_VERSION, "1.3.0", "systemd");
	expect((await queue(identity.agentId)).status).toBe(200);

	await agentsService.revokeRemoteAgentToken(owner.organizationId, identity.agentId);
	expect((await agentsService.getAgent(identity.agentId))?.updateRequest).toBeNull();
	expect((await maintenance(token)).status).toBe(401);
	expect(() => agentUpdates.maintainAgent(identity, { action: "poll" })).toThrow("Invalid agent credential");
});

test("a changed server release supersedes queued targets and startup keeps them superseded after rollback", async () => {
	config.appVersion = "v1.8.0";
	serveRelease();
	const { identity, token } = await prepareAgent(AGENT_PROTOCOL_VERSION, "1.3.0", "systemd");
	expect((await queue(identity.agentId)).status).toBe(200);

	config.appVersion = "v1.9.0";
	await agentsService.markStaleRemoteAgentsOffline();

	config.appVersion = "v1.8.0";
	expect(await (await maintenance(token)).json()).toEqual({ update: null });
	expect((await agentsService.getAgent(identity.agentId))?.updateRequest?.status).toBe("superseded");
});

test.each([
	{ raw: "{", version: "v1.43.0" },
	{ raw: '{"status":"started","target":null}', version: "v1.44.0" },
])("ignores invalid persisted update data at startup and allows a new request ($version)", async ({ raw, version }) => {
	config.appVersion = version;
	const { release } = serveRelease();
	const { identity, token } = await prepareAgent(AGENT_PROTOCOL_VERSION, "1.3.0", "systemd");

	await db
		.update(agentsTable)
		.set({ updateRequest: sql`${raw}` })
		.where(eq(agentsTable.id, identity.agentId));

	await agentsService.markStaleRemoteAgentsOffline();

	expect((await agentsService.getAgent(identity.agentId))?.updateRequest).toBeNull();
	expect(await (await maintenance(token)).json()).toEqual({ update: null });
	expect((await queue(identity.agentId)).status).toBe(200);
	expect(await (await maintenance(token)).json()).toMatchObject({
		update: { status: "queued", target: release },
	});
});

test.each([
	[SUPPORTED_AGENT_PROTOCOL_MIN_VERSION - 1, "agent_too_old", true],
	[SUPPORTED_AGENT_PROTOCOL_MAX_VERSION + 1, "agent_too_new", true],
	[SUPPORTED_AGENT_PROTOCOL_MAX_VERSION + 1, "agent_too_new", false],
])(
	"rejects remote startup protocol %s with reason %s when persistence succeeds=%s",
	async (protocolVersion, reason, persisted) => {
		const { identity } = await prepareAgent(AGENT_PROTOCOL_VERSION, "1.3.0", "systemd");
		const persistRejection = vi.spyOn(agentsService, "markAgentProtocolRejected");
		if (!persisted) persistRejection.mockRejectedValueOnce(new Error("Database unavailable"));

		const onEvent = vi.fn();
		const controller = createAgentController(onEvent);
		await Effect.runPromise(controller.start);

		const data = { ...identity, id: Bun.randomUUIDv7() };
		const transport = { send: vi.fn(), close: vi.fn() };

		try {
			await controller.socket.open(data, transport);
			await controller.socket.message(
				data,
				transport,
				JSON.stringify({
					type: "agent.ready",
					payload: {
						protocolVersion,
						hostname: "remote",
						platform: "linux",
						capabilities: { agentVersion: "1.2.0", trustedRoots: { legacy: true } },
					},
				}),
			);

			await vi.waitFor(() => expect(transport.close).toHaveBeenCalledWith(1002, reason));
			expect(controller.isReady(identity.agentId)).toBe(false);
			expect(
				await Effect.runPromise(
					controller.cancelBackup(identity.agentId, { jobId: "job", scheduleId: "schedule" }),
				),
			).toBe(false);
			expect(persistRejection).toHaveBeenCalledOnce();
			expect(onEvent).toHaveBeenCalledWith(
				expect.objectContaining({
					type: "agent.protocolRejected",
					payload: expect.objectContaining({ reason }),
				}),
			);
			const agent = await agentsService.getAgent(identity.agentId);
			if (persisted) {
				expect(agent?.capabilities).toMatchObject({
					protocolVersion,
					protocolCompatible: false,
					agentVersion: "1.2.0",
				});
				expect(agent?.capabilities.selfUpdate).toBeUndefined();
			} else {
				expect(agent?.capabilities.protocolVersion).toBe(AGENT_PROTOCOL_VERSION);
			}
		} finally {
			await Effect.runPromise(controller.stop);
		}
	},
);

test("an incompatible startup with invalid metadata still supersedes a queued update", async () => {
	config.appVersion = "v1.45.0";
	serveRelease();
	const { identity, token } = await prepareAgent(AGENT_PROTOCOL_VERSION, "1.3.0", "systemd");
	expect((await queue(identity.agentId)).status).toBe(200);

	const controller = createAgentController(() => {});
	const data = { ...identity, id: Bun.randomUUIDv7(), connectionSecurity: "secure" as const };
	const transport = { send: vi.fn(), close: vi.fn() };
	const protocolVersion = SUPPORTED_AGENT_PROTOCOL_MAX_VERSION + 1;
	await Effect.runPromise(controller.start);

	try {
		await controller.socket.open(data, transport);
		await controller.socket.message(
			data,
			transport,
			JSON.stringify({
				type: "agent.ready",
				payload: {
					agentId: identity.agentId,
					protocolVersion,
					hostname: null,
					platform: null,
					capabilities: { agentVersion: "1.45.0", selfUpdate: "systemd" },
				},
			}),
		);

		await vi.waitFor(() => expect(transport.close).toHaveBeenCalledWith(1002, "agent_too_new"));
		expect(controller.isReady(identity.agentId)).toBe(false);
		expect((await agentsService.getAgent(identity.agentId))?.capabilities).toMatchObject({
			protocolVersion,
			protocolCompatible: false,
			agentVersion: "1.45.0",
		});
		expect((await agentsService.getAgent(identity.agentId))?.updateRequest?.status).toBe("superseded");
		expect(await (await maintenance(token)).json()).toEqual({ update: null });
	} finally {
		await Effect.runPromise(controller.stop);
	}
});

test.each([
	{ raw: "{", expected: {}, version: "v1.46.0" },
	{
		raw: '{"agentVersion":"1.3.0","selfUpdate":"systemd"}',
		expected: { agentVersion: "1.3.0" },
		version: "v1.47.0",
	},
])("rotation clears updates and recovers stored capabilities ($version)", async ({ raw, expected, version }) => {
	config.appVersion = version;
	serveRelease();
	const { identity, token } = await prepareAgent(AGENT_PROTOCOL_VERSION, "1.3.0", "systemd");
	expect((await queue(identity.agentId)).status).toBe(200);

	await db
		.update(agentsTable)
		.set({ capabilities: sql`${raw}` })
		.where(eq(agentsTable.id, identity.agentId));

	const rotation = await agentsService.rotateRemoteAgentToken(owner.organizationId, identity.agentId);

	expect(rotation.agent.credentialVersion).toBe(identity.credentialVersion + 1);
	const agent = await agentsService.getAgent(identity.agentId);
	expect(agent?.capabilities).toEqual(expected);
	expect(agent?.updateRequest).toBeNull();
	expect((await maintenance(token)).status).toBe(401);
	const { token: replacement } = await agentsService.exchangeEnrollmentToken(rotation.token);
	expect(await (await maintenance(replacement)).json()).toEqual({ update: null });
});

test("bounds abandoned attempts from their first start and preserves the pinned target through recovery", async () => {
	config.appVersion = "v1.20.0";
	const clock = vi.spyOn(Date, "now");
	const elapsed = vi.spyOn(performance, "now").mockReturnValue(0);
	const startTime = Date.now();
	clock.mockReturnValue(startTime);
	const { release, fetchRelease } = serveRelease();
	const { identity, token } = await prepareAgent(AGENT_PROTOCOL_VERSION, "1.3.0", "systemd");

	const queued = await (await queue(identity.agentId)).json();
	const attempt = { action: "start", requestId: queued.request.id, attemptId: Bun.randomUUIDv7() };

	clock.mockReturnValue(startTime + 60_000);
	elapsed.mockReturnValue(60_000);
	expect((await maintenance(token, attempt)).status).toBe(200);
	const deadline = 31 * 60_000;
	clock.mockReturnValue(startTime - 60 * 60_000);
	elapsed.mockReturnValue(deadline - 1);
	expect((await maintenance(token, attempt)).status).toBe(200);
	expect(await (await maintenance(token)).json()).toEqual({
		update: { requestId: attempt.requestId, status: "started", target: release },
	});
	expect((await agentsService.getAgent(identity.agentId))?.updateRequest).toMatchObject({
		startedAt: startTime + 60_000,
	});

	fetchRelease.mockRestore();
	const refreshed = serveRelease(AGENT_PROTOCOL_VERSION, true, "c");
	const activeOnly = (await agentsService.getAgent(identity.agentId))!;
	expect(await Effect.runPromise(agentUpdates.getReleaseForAgents([activeOnly]))).toBeNull();
	expect(refreshed.fetchRelease).not.toHaveBeenCalled();

	clock.mockReturnValue(startTime + deadline - 1);
	const second = await prepareAgent(AGENT_PROTOCOL_VERSION, "1.3.0", "systemd");
	expect((await queue(second.identity.agentId)).status).toBe(200);
	expect(await (await maintenance(second.token)).json()).toMatchObject({ update: { target: refreshed.release } });

	clock.mockReturnValue(startTime - 60 * 60_000);
	elapsed.mockReturnValue(deadline);
	expect((await maintenance(token, attempt)).status).toBe(409);
	const { update: replacement } = await (await maintenance(token)).json();
	expect(replacement).toEqual({ requestId: expect.any(String), status: "queued", target: release });
	expect(replacement.requestId).not.toBe(attempt.requestId);
	expect((await agentsService.getAgent(identity.agentId))?.updateRequest?.requestedAt).toBe(startTime);
	expect((await maintenance(token, attempt)).status).toBe(409);
	expect((await maintenance(token, { ...attempt, action: "failPreparation" })).status).toBe(409);

	const retry = { action: "start", requestId: replacement.requestId, attemptId: Bun.randomUUIDv7() };
	clock.mockReturnValue(startTime + deadline);
	expect((await maintenance(token, retry)).status).toBe(200);
	expect((await maintenance(token, attempt)).status).toBe(409);
	expect(await (await maintenance(token, { ...attempt, action: "fail" })).json()).toEqual({ update: null });
	expect((await maintenance(token, { ...retry, action: "fail", attemptId: Bun.randomUUIDv7() })).status).toBe(409);
	expect(await (await maintenance(token)).json()).toMatchObject({ update: { ...replacement, status: "started" } });

	elapsed.mockReturnValue(deadline + 30 * 60_000);
	const { update: renewedAgain } = await (await maintenance(token)).json();
	expect(renewedAgain).toEqual({ requestId: expect.any(String), status: "queued", target: release });
	expect([attempt.requestId, retry.requestId]).not.toContain(renewedAgain.requestId);
	expect((await maintenance(token, attempt)).status).toBe(409);
	expect((await maintenance(token, { ...attempt, action: "failPreparation" })).status).toBe(409);
	expect(
		(await maintenance(token, { ...retry, requestId: renewedAgain.requestId, attemptId: Bun.randomUUIDv7() }))
			.status,
	).toBe(200);
});

test("bounds a recovered attempt by server uptime even if its wall timestamp is in the future", async () => {
	config.appVersion = "v1.25.0";
	const { release } = serveRelease();
	const { identity, token } = await prepareAgent(AGENT_PROTOCOL_VERSION, "1.3.0", "systemd");
	const queued = await (await queue(identity.agentId)).json();
	const requestId = queued.request.id;
	const start = { action: "start", requestId, attemptId: Bun.randomUUIDv7() };
	const deadline = 30 * 60_000;

	await db
		.update(agentsTable)
		.set({
			updateRequest: {
				status: "started",
				requestId,
				attemptId: start.attemptId,
				target: release,
				requestedAt: Date.now(),
				startedAt: Date.now() + 60 * 60_000,
				lease: { processId: Bun.randomUUIDv7(), deadline: 4 * deadline },
			},
		})
		.where(eq(agentsTable.id, identity.agentId));

	const elapsed = vi.spyOn(performance, "now").mockReturnValue(deadline - 1);
	expect((await maintenance(token, start)).status).toBe(200);

	elapsed.mockReturnValue(deadline);
	expect((await maintenance(token, start)).status).toBe(409);
	const { update } = await (await maintenance(token)).json();
	expect(update).toEqual({ requestId: expect.any(String), status: "queued", target: release });
	expect(update.requestId).not.toBe(requestId);
});

test("offers manual updates for legacy agents without fetching signed assets", async () => {
	config.appVersion = "v1.21.0";
	const { fetchRelease } = serveRelease();
	const compatible = await prepareAgent(AGENT_PROTOCOL_VERSION);
	const older = await prepareAgent(SUPPORTED_AGENT_PROTOCOL_MIN_VERSION - 1);
	const rows = await Promise.all(
		[compatible, older].map(async ({ identity }) => (await agentsService.getAgent(identity.agentId))!),
	);

	expect(await Effect.runPromise(agentUpdates.getReleaseForAgents(rows))).toBeNull();
	expect(fetchRelease).not.toHaveBeenCalled();
	expect(agentUpdates.presentUpdate(rows[0], null)).toMatchObject({
		availability: "available",
		delivery: "manual",
		targetTag: config.appVersion,
	});
	expect(agentUpdates.presentUpdate(rows[1], null)).toMatchObject({
		availability: "required",
		delivery: "manual",
		targetTag: config.appVersion,
	});
});

test("rechecks the caller's organization role after release verification", async () => {
	config.appVersion = "v1.22.0";
	const { fetchRelease } = serveRelease();
	const { identity } = await prepareAgent(AGENT_PROTOCOL_VERSION, "1.3.0", "systemd");
	const fetchAsset = fetchRelease.getMockImplementation()!;
	const pending = Promise.withResolvers<void>();
	fetchRelease.mockImplementation(async (...args) => {
		await pending.promise;
		return fetchAsset(...args);
	});

	const key = await auth.api.createApiKey({
		body: {
			name: "agent queue test",
			userId: owner.user.id,
			metadata: { organizationId: owner.organizationId },
			rateLimitEnabled: false,
		},
	});
	expect((await queue(identity.agentId, { "x-api-key": key.key })).status).toBe(401);
	expect(fetchRelease).not.toHaveBeenCalled();

	const response = queue(identity.agentId);
	try {
		await vi.waitFor(() => expect(fetchRelease).toHaveBeenCalledOnce());
		await db.update(members).set({ role: "member" }).where(eq(members.userId, owner.user.id));
		pending.resolve();

		expect((await response).status).toBe(403);
		expect((await agentsService.getAgent(identity.agentId))?.updateRequest).toBeNull();
	} finally {
		pending.resolve();
		await response;
		await db.update(members).set({ role: "owner" }).where(eq(members.userId, owner.user.id));
	}
	expect((await queue(identity.agentId)).status).toBe(200);
});

test.each([AGENT_PROTOCOL_VERSION, SUPPORTED_AGENT_PROTOCOL_MIN_VERSION - 1])(
	"uses the observed connection security for protocol %s and supersedes a queued update on plaintext reconnect",
	async (protocolVersion) => {
		config.appVersion = protocolVersion === AGENT_PROTOCOL_VERSION ? "v1.23.0" : "v1.24.0";
		serveRelease();
		const { identity, token } = await prepareAgent(undefined);
		const controller = createAgentController(() => {});
		vi.spyOn(agentManagerModule, "getAgentController").mockReturnValue(controller);
		await Effect.runPromise(controller.start);

		type Handler = {
			upgrade(request: Request): Promise<{ context: unknown }>;
			open(peer: object): Promise<void>;
			message(peer: object, message: { rawData: string; text: () => string }): Promise<void>;
			close(peer: object): Promise<void>;
		};
		const route = connectRoute as unknown as (event: object) => { crossws: Handler };
		const handler = route({}).crossws;
		const ready = JSON.stringify({
			type: "agent.ready",
			payload: {
				agentId: identity.agentId,
				protocolVersion,
				hostname: "remote",
				platform: "linux",
				capabilities: { agentVersion: "1.3.0", selfUpdate: "systemd", connectionSecurity: "secure" },
			},
		});
		const handshake = async (scheme: "http" | "https") => {
			const { context } = await handler.upgrade(
				new Request(`${scheme}://localhost/api/v1/agents/connect`, {
					headers: { authorization: `Bearer ${token}` },
				}),
			);
			const peer = { context, send: vi.fn(), close: vi.fn() };
			await handler.open(peer);
			await handler.message(peer, { rawData: ready, text: () => ready });
			await vi.waitFor(async () => {
				const agent = await agentsService.getAgent(identity.agentId);
				expect(agent?.capabilities).toMatchObject({
					protocolVersion,
					connectionSecurity: scheme === "https" ? "secure" : "insecure",
				});
			});
			await handler.close(peer);
		};

		const allowInsecure = config.flags.allowInsecureAgentHttp;
		config.flags.allowInsecureAgentHttp = true;
		try {
			await handshake("https");
			expect((await queue(identity.agentId)).status).toBe(200);
			expect(await (await maintenance(token)).json()).toMatchObject({ update: { status: "queued" } });

			await handshake("http");
			expect((await queue(identity.agentId)).status).toBe(409);
			expect(await (await maintenance(token)).json()).toEqual({ update: null });
			const agent = (await agentsService.getAgent(identity.agentId))!;
			expect(agentUpdates.presentUpdate(agent, null)).toMatchObject({
				delivery: "manual",
				request: { status: "superseded" },
			});

			await handshake("https");
			expect(await (await maintenance(token)).json()).toEqual({ update: null });
			expect((await queue(identity.agentId)).status).toBe(200);
		} finally {
			config.flags.allowInsecureAgentHttp = allowInsecure;
			await Effect.runPromise(controller.stop);
		}
	},
);

test("final authorization waits for the controller to resolve the tracked backup", async () => {
	const { release } = serveRelease();
	const { identity, token } = await prepareAgent(AGENT_PROTOCOL_VERSION, "1.3.0", "systemd");
	const queued = await (await queue(identity.agentId)).json();
	const start = { action: "start", requestId: queued.request.id, attemptId: Bun.randomUUIDv7() };

	const runs = getAgentRuntimeState().activeBackupsByScheduleId;
	const run = {
		agentId: identity.agentId,
		scheduleId: -1,
		scheduleShortId: "schedule",
		jobId: "terminal-in-inbox",
		onProgress: vi.fn(),
		resolve: vi.fn(),
		cancellationRequested: false,
	};

	runs.set(-1, run);
	try {
		expect((await maintenance(token, start)).status).toBe(409);
		expect((await agentsService.getAgent(identity.agentId))?.updateRequest?.status).toBe("queued");
		runs.set(-1, { ...run, agentId: "another-agent" });
		expect(await (await maintenance(token, start)).json()).toEqual({
			update: { requestId: start.requestId, status: "started", target: release },
		});
		runs.set(-1, run);
		expect((await maintenance(token, start)).status).toBe(409);
	} finally {
		runs.delete(-1);
	}
	expect((await maintenance(token, start)).status).toBe(200);
});

test("a preparation failure settles the exact queued request without starting a lease", async () => {
	const { release } = serveRelease();
	const { identity, token } = await prepareAgent(AGENT_PROTOCOL_VERSION, "1.3.0", "systemd");
	const queued = await (await queue(identity.agentId)).json();
	const first = { action: "start", requestId: queued.request.id, attemptId: Bun.randomUUIDv7() };
	const elapsed = vi.spyOn(performance, "now").mockReturnValue(0);

	expect((await maintenance(token, first)).status).toBe(200);
	expect((await maintenance(token, { ...first, action: "failPreparation" })).status).toBe(409);

	elapsed.mockReturnValue(30 * 60 * 1000);
	const { update } = await (await maintenance(token)).json();
	expect(update).toEqual({ status: "queued", target: release, requestId: expect.any(String) });
	expect(update.requestId).not.toBe(first.requestId);

	const failure = { action: "failPreparation", requestId: update.requestId, attemptId: Bun.randomUUIDv7() };
	expect((await maintenance(token, { ...failure, attemptId: first.attemptId })).status).toBe(410);
	expect((await maintenance(token, { ...failure, requestId: Bun.randomUUIDv7() })).status).toBe(409);
	expect(await (await maintenance(token, failure)).json()).toEqual({ update: null });
	expect((await maintenance(token, failure)).status).toBe(200);
	expect(agentUpdates.isBackupDispatchFenced(identity.agentId)).toBe(false);
	expect((await agentsService.getAgent(identity.agentId))?.updateRequest).toMatchObject({
		status: "failed",
		requestId: failure.requestId,
		attemptId: failure.attemptId,
	});
	expect(await (await maintenance(token)).json()).toEqual({ update: null });
});

test.each(["unconfirmed", "confirmed", "restored snapshot"])(
	"fences backup dispatch across lease expiry (%s)",
	async (state) => {
		const confirmed = state !== "unconfirmed";
		const restored = state === "restored snapshot";
		const clock = vi.spyOn(Date, "now");
		const elapsed = vi.spyOn(performance, "now").mockReturnValue(0);
		const startedAt = Date.now();
		clock.mockReturnValue(startedAt);
		const { release } = serveRelease();
		const { identity, token } = await prepareAgent(AGENT_PROTOCOL_VERSION, "1.3.0", "systemd");
		const queued = await (await queue(identity.agentId)).json();
		const attempt = { requestId: queued.request.id, attemptId: Bun.randomUUIDv7() };
		const confirm = { action: "confirm", ...attempt };
		const accept = { action: "accept", ...attempt };

		const originalEnvironment = config.environment;
		const originalTrustProxy = config.trustProxy;
		config.environment = "development";
		config.trustProxy = true;

		const controller = createAgentController(vi.fn());
		const received: string[] = [];
		const Socket = globalThis.WebSocket as unknown as {
			new (url: string, options: Bun.WebSocketOptions): WebSocket;
		};
		const connect = async (agentVersion: string, updateTrial?: typeof attempt & { locallyAccepted?: true }) => {
			const socket = new Socket(`${controller.getControllerUrl()}/api/v1/agents/connect`, {
				headers: { authorization: `Bearer ${token}`, "x-forwarded-proto": "https" },
			});
			socket.addEventListener("message", (event) => received.push(String(event.data)));
			await new Promise<void>((resolve, reject) => {
				socket.addEventListener("open", () => resolve(), { once: true });
				socket.addEventListener("error", () => reject(new Error("Could not connect trial socket")), {
					once: true,
				});
			});
			socket.send(
				JSON.stringify({
					type: "agent.ready",
					payload: {
						agentId: identity.agentId,
						protocolVersion: AGENT_PROTOCOL_VERSION,
						hostname: "remote",
						platform: "linux",
						capabilities: {
							agentVersion,
							updateTrial,
							selfUpdate: "systemd",
							trustedRoots: [{ id: "root", label: "Root", canBackup: true }],
						},
					},
				}),
			);
			expect(await Effect.runPromise(controller.waitForReady(identity.agentId, "1 second"))).toBe(true);
		};

		const dispatch = () =>
			Effect.runPromise(
				controller.sendBackup(identity.agentId, {
					jobId: "job",
					scheduleId: "schedule",
					organizationId: owner.organizationId,
					source: { rootId: "root", relativePath: "" },
					repositoryConfig: { backend: "local", path: "/tmp/repository" },
					options: {
						oneFileSystem: false,
						excludePatterns: null,
						excludeIfPresent: null,
						includePaths: null,
						includePatterns: null,
						customResticParams: null,
						compressionMode: "auto",
					},
					runtime: { password: "password" },
					webhooks: { pre: null, post: null },
					webhookAllowedOrigins: [],
					webhookTimeoutMs: 60_000,
				}),
			);

		try {
			await Effect.runPromise(controller.start);
			await connect("1.3.0");
			expect(await dispatch()).toBe(true);
			await vi.waitFor(() =>
				expect(received.some((message) => JSON.parse(message).type === "backup.run")).toBe(true),
			);
			expect((await maintenance(token, { action: "start", ...attempt })).status).toBe(200);
			const startedSnapshot = (await agentsService.getAgent(identity.agentId))!.updateRequest;
			expect(await dispatch()).toBe(false);
			expect((await maintenance(token, confirm)).status).toBe(409);

			await connect(release.tag);
			expect(await dispatch()).toBe(false);
			expect((await maintenance(token, confirm)).status).toBe(409);
			await connect("1.3.0", attempt);
			expect((await maintenance(token, confirm)).status).toBe(409);
			await connect(release.tag, { ...attempt, attemptId: Bun.randomUUIDv7() });
			expect((await maintenance(token, confirm)).status).toBe(409);
			clock.mockReturnValue(startedAt - 60 * 60 * 1000);
			await connect(release.tag, attempt);
			expect((await agentsService.getAgent(identity.agentId))?.lastReadyAt).toBeLessThan(startedAt);
			expect((await maintenance(token, accept)).status).toBe(409);
			if (confirmed) {
				expect(await (await maintenance(token, confirm)).json()).toEqual({ update: null });
				expect(await (await maintenance(token, confirm)).json()).toEqual({ update: null });
			}
			elapsed.mockReturnValue(30 * 60 * 1000);
			expect(await dispatch()).toBe(false);
			expect((await maintenance(token, confirm)).status).toBe(409);
			expect(await (await maintenance(token)).json()).toMatchObject({ update: { requestId: attempt.requestId } });

			await Effect.runPromise(controller.stop);
			expect(agentUpdates.isBackupDispatchFenced(identity.agentId)).toBe(false);
			expect((await maintenance(token, accept)).status).toBe(409);

			if (confirmed) {
				expect(await (await maintenance(token)).json()).toMatchObject({
					update: { requestId: attempt.requestId },
				});
			}

			if (restored) {
				db.update(agentsTable)
					.set({ updateRequest: startedSnapshot })
					.where(eq(agentsTable.id, identity.agentId))
					.run();
			}

			await Effect.runPromise(controller.start);
			await connect(release.tag, attempt);
			expect(await dispatch()).toBe(false);
			if (restored) {
				expect((await maintenance(token, accept)).status).toBe(409);
				await connect(release.tag, { ...attempt, locallyAccepted: true });
				expect(await dispatch()).toBe(false);
			}
			expect((await maintenance(token, confirm)).status).toBe(409);
			expect((await maintenance(token, { ...accept, attemptId: Bun.randomUUIDv7() })).status).toBe(410);
			if (confirmed) {
				expect(await (await maintenance(token, accept)).json()).toEqual({ update: null });
				await connect(release.tag, { ...attempt, locallyAccepted: true });
				expect(await (await maintenance(token, accept)).json()).toEqual({ update: null });
				const agent = (await agentsService.getAgent(identity.agentId))!;
				expect(agentUpdates.presentUpdate(agent, null).request?.status).toBe("completed");
				expect((await maintenance(token, { action: "fail", ...attempt })).status).toBe(410);
			} else {
				expect((await maintenance(token, accept)).status).toBe(409);
				await connect("1.3.0");
				expect(await dispatch()).toBe(true);
				await connect(release.tag, attempt);
				expect(await dispatch()).toBe(false);
				expect(await (await maintenance(token, { action: "fail", ...attempt })).json()).toEqual({
					update: null,
				});
			}
			expect(await dispatch()).toBe(true);
		} finally {
			await Effect.runPromise(controller.stop);
			config.environment = originalEnvironment;
			config.trustProxy = originalTrustProxy;
		}
	},
);

test("lets a reconnected machine update again after restoring an expired confirmation", async () => {
	config.appVersion = "v1.45.0";
	const { release, fetchRelease } = serveRelease();
	const { identity, token } = await prepareAgent(AGENT_PROTOCOL_VERSION, "1.3.0", "systemd");
	const elapsed = vi.spyOn(performance, "now").mockReturnValue(0);
	const queued = await (await queue(identity.agentId)).json();
	const attempt = { requestId: queued.request.id, attemptId: Bun.randomUUIDv7() };
	const { capabilities } = (await agentsService.getAgent(identity.agentId))!;

	expect((await maintenance(token, { action: "start", ...attempt })).status).toBe(200);
	const upgraded = { ...capabilities, agentVersion: release.tag };
	await agentsService.markAgentOnline(identity, { ...upgraded, updateTrial: attempt });
	expect((await maintenance(token, { action: "confirm", ...attempt })).status).toBe(200);
	const confirming = (await agentsService.getAgent(identity.agentId))!.updateRequest;
	expect((await maintenance(token, { action: "accept", ...attempt })).status).toBe(200);

	db.update(agentsTable).set({ updateRequest: confirming }).where(eq(agentsTable.id, identity.agentId)).run();
	await agentsService.markAgentOffline(identity);
	await agentsService.markAgentOnline(identity, upgraded);

	config.appVersion = "v1.46.0";
	fetchRelease.mockRestore();
	serveRelease();
	expect((await (await queue(identity.agentId)).json()).request.id).toBe(attempt.requestId);

	elapsed.mockReturnValue(30 * 60_000);
	const listed = await Effect.runPromise(agentsService.listOrganizationAgents(owner.organizationId));
	expect(listed.find((agent) => agent.id === identity.agentId)?.update).toMatchObject({
		targetTag: config.appVersion,
		delivery: "remote",
		request: { status: "superseded" },
	});

	const response = await queue(identity.agentId);
	expect(response.status).toBe(200);
	const renewed = await response.json();
	expect(renewed.request).toMatchObject({ status: "queued", targetTag: config.appVersion });
	expect(renewed.request.id).not.toBe(attempt.requestId);
});

test("returns a terminal response for acceptance after restoring before the attempt started", async () => {
	serveRelease();
	const { identity, token } = await prepareAgent(AGENT_PROTOCOL_VERSION, "1.3.0", "systemd");
	const queued = await (await queue(identity.agentId)).json();
	const accept = { action: "accept", requestId: queued.request.id, attemptId: Bun.randomUUIDv7() };

	expect((await maintenance(token, accept)).status).toBe(410);
	expect((await agentsService.getAgent(identity.agentId))?.updateRequest?.status).toBe("queued");

	db.update(agentsTable).set({ updateRequest: null }).where(eq(agentsTable.id, identity.agentId)).run();

	expect((await maintenance(token, accept)).status).toBe(410);
});

test.each(["current", "legacy"])(
	"accepts rollback after lease renewal and allows a new request (%s)",
	async (format) => {
		const clock = vi.spyOn(Date, "now");
		const elapsed = vi.spyOn(performance, "now").mockReturnValue(0);
		const startedAt = Date.now();
		clock.mockReturnValue(startedAt);
		const { release } = serveRelease();
		const { identity, token } = await prepareAgent(AGENT_PROTOCOL_VERSION, "1.3.0", "systemd");
		const queued = await (await queue(identity.agentId)).json();
		const attempt = { requestId: queued.request.id, attemptId: Bun.randomUUIDv7() };

		expect((await maintenance(token, { action: "start", ...attempt })).status).toBe(200);
		expect(agentUpdates.isBackupDispatchFenced(identity.agentId)).toBe(true);
		elapsed.mockReturnValue(30 * 60 * 1000);
		expect(agentUpdates.isBackupDispatchFenced(identity.agentId)).toBe(false);
		expect((await maintenance(token, { action: "confirm", ...attempt })).status).toBe(409);

		const { update: renewed } = await (await maintenance(token)).json();
		expect(renewed).toEqual({ requestId: expect.any(String), status: "queued", target: release });
		expect(renewed.requestId).not.toBe(attempt.requestId);

		const currentRequestId = renewed.requestId;
		if (format === "legacy") {
			const oldRow = {
				requestId: currentRequestId,
				target: release,
				requestedAt: startedAt,
				status: "queued",
				previousAttempt: { ...attempt, renewedRequestId: currentRequestId },
			};

			db.update(agentsTable)
				.set({ updateRequest: sql`${JSON.stringify(oldRow)}` })
				.where(eq(agentsTable.id, identity.agentId))
				.run();
			expect(await (await maintenance(token)).json()).toEqual({
				update: { ...renewed, requestId: currentRequestId },
			});
		}

		const failure = { action: "fail", ...attempt };
		expect((await maintenance(token, { ...failure, requestId: currentRequestId })).status).toBe(409);
		expect((await maintenance(token, { ...failure, attemptId: Bun.randomUUIDv7() })).status).toBe(409);
		expect(await (await maintenance(token, failure)).json()).toEqual({ update: null });
		expect((await agentsService.getAgent(identity.agentId))?.updateRequest?.status).toBe("failed");

		const retry = await (await queue(identity.agentId)).json();
		expect(retry.request.id).not.toBe(currentRequestId);
		expect(await (await maintenance(token, failure)).json()).toEqual({ update: null });
		expect(
			(await maintenance(token, { action: "start", requestId: retry.request.id, attemptId: attempt.attemptId }))
				.status,
		).toBe(409);
		expect(
			(await maintenance(token, { action: "start", requestId: retry.request.id, attemptId: Bun.randomUUIDv7() }))
				.status,
		).toBe(200);
	},
);

test.each([false, true])("acknowledges rollback across a release change (lease expired: %s)", async (expired) => {
	const clock = vi.spyOn(Date, "now");
	const elapsed = vi.spyOn(performance, "now").mockReturnValue(0);
	const startedAt = Date.now();
	clock.mockReturnValue(startedAt);
	const { fetchRelease, release } = serveRelease();
	const { identity, token } = await prepareAgent(AGENT_PROTOCOL_VERSION, "1.3.0", "systemd");
	const queued = await (await queue(identity.agentId)).json();
	const attempt = { requestId: queued.request.id, attemptId: Bun.randomUUIDv7() };
	expect((await maintenance(token, { action: "start", ...attempt })).status).toBe(200);

	const capabilities = (await agentsService.getAgent(identity.agentId))!.capabilities;
	await agentsService.markAgentOnline(identity, { ...capabilities, agentVersion: release.tag, updateTrial: attempt });
	expect((await maintenance(token, { action: "confirm", ...attempt })).status).toBe(200);

	config.appVersion = expired ? "v1.41.0" : "v1.42.0";
	fetchRelease.mockRestore();
	serveRelease();
	const failure = { action: "fail", ...attempt };
	if (expired) elapsed.mockReturnValue(30 * 60 * 1000);
	expect(agentUpdates.isBackupDispatchFenced(identity.agentId)).toBe(true);
	expect(await (await maintenance(token, failure)).json()).toEqual({ update: null });

	await agentsService.markAgentOnline(identity, capabilities);
	const response = await queue(identity.agentId);
	const next = await response.json();
	expect(response.status, JSON.stringify(next)).toBe(200);
	expect(next.request.targetTag).toBe(config.appVersion);
	expect(await (await maintenance(token, failure)).json()).toEqual({ update: null });
	expect(await (await maintenance(token)).json()).toMatchObject({ update: { requestId: next.request.id } });
	expect(agentUpdates.isBackupDispatchFenced(identity.agentId)).toBe(false);
});

test.each(["same queued request", "no request", "replacement request"])(
	"reconciles rollback after restoring a controller with %s",
	async (snapshot) => {
		serveRelease();
		const { identity, token } = await prepareAgent(AGENT_PROTOCOL_VERSION, "1.3.0", "systemd");
		expect((await queue(identity.agentId)).status).toBe(200);
		const queued = (await agentsService.getAgent(identity.agentId))!.updateRequest!;
		const attempt = { requestId: queued.requestId, attemptId: Bun.randomUUIDv7() };

		expect((await maintenance(token, { action: "start", ...attempt })).status).toBe(200);

		const restored =
			snapshot === "no request"
				? null
				: {
						...queued,
						requestId: snapshot === "same queued request" ? queued.requestId : Bun.randomUUIDv7(),
					};
		db.update(agentsTable).set({ updateRequest: restored }).where(eq(agentsTable.id, identity.agentId)).run();

		const fail = { action: "fail", ...attempt };
		expect(await (await maintenance(token, fail)).json()).toEqual({ update: null });
		expect(await (await maintenance(token, fail)).json()).toEqual({ update: null });
		if (snapshot === "same queued request") {
			expect((await agentsService.getAgent(identity.agentId))?.updateRequest).toMatchObject({
				...attempt,
				status: "failed",
			});
			expect((await maintenance(token, { action: "start", ...attempt })).status).toBe(409);
		} else {
			expect((await agentsService.getAgent(identity.agentId))?.updateRequest).toEqual(restored);
		}
		const next = await (await queue(identity.agentId)).json();
		expect(next.request.id).not.toBe(attempt.requestId);
		expect((await maintenance(token, { action: "accept", ...attempt })).status).toBe(410);
		expect(
			(await maintenance(token, { action: "start", requestId: next.request.id, attemptId: Bun.randomUUIDv7() }))
				.status,
		).toBe(200);
	},
);
