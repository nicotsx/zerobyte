import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { link, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AGENT_PROTOCOL_VERSION } from "@zerobyte/contracts/agent-protocol";
import {
	AGENT_RELEASE_ATTESTATION_ASSET,
	AgentAttestationInvalid,
	agentReleaseAssetUrl,
	agentReleaseManifestSchema,
	fetchAgentReleaseAsset,
	type AgentReleaseManifest,
} from "@zerobyte/contracts/agent-release";
import { Clock, Effect, Exit, Fiber } from "effect";
import { TestClock } from "effect/testing";
import { z } from "zod";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { createMaintenanceClient, maintenanceUrl } from "../maintenance-client";
import { getLocalUpdateTrial, readLocalUpdateState, saveUpdateAttempt } from "../local-update-state";
import { confirmUpdateTrial, runSelfUpdate } from "../self-update";
import {
	commitSystemdUpdate,
	isSystemdServiceCgroup,
	notifySystemdReady,
	systemdRecoveryScript,
} from "../systemd-update";
import { createUpdateJobs } from "../update-jobs";
import { stageUpdate } from "../update-release";

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

const binary = `#!/bin/sh\nprintf '%s\\n' 'v2.0.0 ${AGENT_PROTOCOL_VERSION}'\n`;
const target: AgentReleaseManifest = {
	formatVersion: 1,
	tag: "v2.0.0",
	protocolVersion: AGENT_PROTOCOL_VERSION,
	sha256: { x64: "0".repeat(64), arm64: createHash("sha256").update(binary).digest("hex") },
};

const configuration = {
	controllerUrl: "wss://controller.example:9443/api/v1/agents/connect",
	token: "machine-token",
	roots: [],
};
let directory: string;

beforeEach(async () => {
	directory = await mkdtemp(join(tmpdir(), "zerobyte-update-"));
});

afterEach(async () => {
	vi.unstubAllGlobals();
	vi.unstubAllEnvs();
	await rm(directory, { recursive: true, force: true });
});

function readUpdateAttempt(directory: string) {
	const state = readLocalUpdateState(directory);

	return "attempt" in state ? state.attempt : undefined;
}

test("maintenance only sends the machine bearer to the configured HTTPS origin", async () => {
	expect(maintenanceUrl("ws://localhost:9443/connect")).toBeNull();
	expect(maintenanceUrl("http://controller.example/connect")).toBeNull();
	expect(maintenanceUrl("wss://user:pass@controller.example/connect")).toBeNull();

	const fetch = vi.fn(async () => Response.json({ update: null }));
	vi.stubGlobal("fetch", fetch);

	const maintenance = createMaintenanceClient(configuration)!;
	await expect(Effect.runPromise(maintenance({ action: "poll" }))).resolves.toEqual({
		type: "response",
		update: null,
	});
	expect(fetch).toHaveBeenCalledWith(
		new URL("https://controller.example:9443/api/v1/agents/maintenance"),
		expect.objectContaining({
			redirect: "error",
			method: "POST",
			tls: { rejectUnauthorized: true },
			headers: { authorization: "Bearer machine-token", "content-type": "application/json" },
			body: '{"action":"poll"}',
		}),
	);
});

test("interrupts a stalled maintenance response without holding its reader lock", async () => {
	const cancel = vi.fn(() => new Promise<void>(() => {}));
	const body = new ReadableStream<Uint8Array>({ cancel });
	const fetch = vi.fn(async () => new Response(body));
	vi.stubGlobal("fetch", fetch);

	const maintenance = createMaintenanceClient(configuration)!;
	const caller = new AbortController();
	const result = Effect.runPromiseExit(maintenance({ action: "poll" }), { signal: caller.signal });

	try {
		await vi.waitFor(() => expect(body.locked).toBe(true));
	} finally {
		caller.abort();
	}

	expect(Exit.isFailure(await result)).toBe(true);
	expect(cancel).toHaveBeenCalledOnce();
	expect(body.locked).toBe(false);
});

test("follows only the official release asset route without the machine credential", async () => {
	const asset = AGENT_RELEASE_ATTESTATION_ASSET;
	const github = `https://github.com/nicotsx/zerobyte/releases/download/v2.0.0/${asset}`;
	const cdn = "https://release-assets.githubusercontent.com/example?signature=example";
	const fetch = vi
		.fn<(url: URL, options: RequestInit) => Promise<Response>>()
		.mockResolvedValueOnce(Response.redirect(github))
		.mockResolvedValueOnce(Response.redirect(cdn))
		.mockResolvedValueOnce(new Response("bundle"));
	vi.stubGlobal("fetch", fetch);

	const official = agentReleaseAssetUrl(target.tag, asset);
	const response = await fetchAgentReleaseAsset(official, new AbortController().signal);
	expect(await response.text()).toBe("bundle");
	expect(fetch.mock.calls.map(([url]) => url.href)).toEqual([official.href, github, cdn]);
	expect(fetch.mock.calls.every(([, options]) => !options.headers && options.redirect === "manual")).toBe(true);
});

test.each(["unverified", "protocol", "other architecture", "digest", "version", "downgrade", "redirect", "valid"])(
	"staging handles %s",
	async (variation) => {
		const manifest = { ...target, sha256: { ...target.sha256 } };
		if (variation === "protocol") manifest.protocolVersion++;
		if (variation === "other architecture") manifest.sha256.x64 = "1".repeat(64);
		const bundle = variation === "unverified" ? "unverified" : JSON.stringify(manifest);

		const fetch = vi.fn(async (url: URL) => {
			if (variation === "redirect") return Response.redirect("https://example.net/asset");
			if (url.pathname.endsWith(AGENT_RELEASE_ATTESTATION_ASSET)) return new Response(bundle);
			return new Response(variation === "digest" ? "corrupt" : binary);
		});
		vi.stubGlobal("fetch", fetch);

		const staged = join(directory, "staged");
		const pin = variation === "version" ? { ...target, tag: "v2.0.1" } : target;
		const operation = Effect.runPromise(
			stageUpdate(pin, variation === "downgrade" ? "v2.1.0" : "v1.0.0", "arm64", staged),
		);

		if (variation === "valid") {
			await operation;
			expect(await readFile(staged, "utf8")).toBe(binary);
			expect(fetch.mock.calls.map(([url]) => url.pathname)).toContain("/agent/v2.0.0/zerobyte-agent-linux-arm64");
		} else {
			await expect(operation).rejects.toThrow();
			if (variation === "downgrade") expect(fetch).not.toHaveBeenCalled();
			if (variation === "redirect")
				expect(fetch.mock.calls.every(([url]) => url.host === "zerobyte.app")).toBe(true);
			if (["unverified", "protocol", "other architecture", "version"].includes(variation))
				expect(fetch).toHaveBeenCalledOnce();
		}
		for (const call of fetch.mock.calls) {
			expect(call[0].origin).toBe("https://zerobyte.app");
		}
	},
);

test.each(["stale", "cancelled", "accepted"])(
	"revalidates the persisted attempt before swapping when authorization is %s",
	async (authorization) => {
		vi.stubEnv("ZEROBYTE_AGENT_VERSION", "v1.0.0");
		const requestId = randomUUID();
		const attemptId = randomUUID();
		const signedTarget = { ...target, sha256: { x64: target.sha256.arm64, arm64: target.sha256.arm64 } };
		saveUpdateAttempt(directory, { requestId, attemptId, target: signedTarget, failed: false });
		const bytes = Buffer.from(JSON.stringify(signedTarget));

		const shutdown = new AbortController();
		const jobs = createUpdateJobs();
		let starts = 0;
		vi.stubGlobal("fetch", async (url: URL, options: RequestInit) => {
			if (url.pathname.endsWith(AGENT_RELEASE_ATTESTATION_ASSET)) return new Response(bytes);
			if (url.hostname !== "controller.example") return new Response(binary);

			const request = JSON.parse(typeof options.body === "string" ? options.body : "");
			if (request.action === "start") {
				expect(request).toEqual({ action: "start", requestId, attemptId });
				expect(readUpdateAttempt(directory)?.attemptId).toBe(attemptId);
				expect(await readFile(join(directory, "staged"), "utf8")).toBe(binary);
				expect(jobs.admit("schedule-1")).toMatchObject({ _tag: "UpdateCommitting" });
				starts++;
				if (authorization === "stale") return new Response(null, { status: 409 });
				if (authorization === "cancelled") {
					await new Promise<void>((resolve) => options.signal?.addEventListener("abort", () => resolve()));
				}
			}
			return Response.json({ update: { requestId, status: "started", target: signedTarget } });
		});

		const installed = join(directory, "agent");
		await writeFile(installed, "installed");
		const result = Effect.runPromiseExit(runSelfUpdate({ binary: installed, directory }, configuration, jobs), {
			signal: shutdown.signal,
		});
		if (authorization !== "accepted") {
			await vi.waitFor(() => expect(starts).toBe(1));
			if (authorization === "stale") {
				await vi.waitFor(() => {
					expect(jobs.admit("schedule-1")).toBeUndefined();
					jobs.finish("schedule-1");
				});
			}
			shutdown.abort();
		}

		const committed = await result;
		expect(starts).toBe(1);
		if (authorization === "accepted") {
			expect(committed).toEqual(Exit.succeed(true));
			expect(jobs.admit("schedule-1")).toMatchObject({ _tag: "UpdateCommitting" });
			expect(await readFile(installed, "utf8")).toBe(binary);
			expect(await readFile(join(directory, "pending"), "utf8")).toBe("installed");
		} else {
			expect(Exit.isFailure(committed)).toBe(true);
			expect(jobs.admit("schedule-1")).toBeUndefined();
			expect(await readFile(installed, "utf8")).toBe("installed");
		}
		expect(readUpdateAttempt(directory)?.attemptId).toBe(attemptId);
	},
);

test("renews an expired local attempt for a previously queued request with the same ID", async () => {
	vi.stubEnv("ZEROBYTE_AGENT_VERSION", "v1.0.0");
	const requestId = randomUUID();
	const expiredAttemptId = randomUUID();
	const signedTarget = { ...target, sha256: { x64: target.sha256.arm64, arm64: target.sha256.arm64 } };
	const service = { binary: join(directory, "agent"), directory };
	await writeFile(service.binary, "installed");
	saveUpdateAttempt(directory, { requestId, attemptId: expiredAttemptId, target: signedTarget, failed: false });

	const starts: string[] = [];
	vi.stubGlobal("fetch", async (url: URL, options: RequestInit) => {
		if (url.pathname.endsWith(AGENT_RELEASE_ATTESTATION_ASSET)) return Response.json(signedTarget);
		if (url.hostname !== "controller.example") return new Response(binary);

		const request = JSON.parse(typeof options.body === "string" ? options.body : "");
		if (request.action === "poll") {
			return Response.json({ update: { requestId, status: "queued", target: signedTarget } });
		}

		expect(request).toMatchObject({ action: "start", requestId });
		expect(readUpdateAttempt(directory)?.attemptId).toBe(request.attemptId);
		starts.push(request.attemptId);
		if (request.attemptId === expiredAttemptId) return new Response(null, { status: 410 });

		return Response.json({ update: { requestId, status: "started", target: signedTarget } });
	});

	const committed = await Effect.runPromise(
		Effect.gen(function* () {
			const updater = yield* Effect.forkChild(runSelfUpdate(service, configuration, createUpdateJobs()));
			yield* Effect.promise(() =>
				vi.waitFor(() => expect(readLocalUpdateState(directory)).toMatchObject({ phase: "idle" })),
			);
			yield* TestClock.adjust("15 seconds");
			return yield* Fiber.join(updater);
		}).pipe(Effect.provide(TestClock.layer())),
	);

	expect(committed).toBe(true);
	expect(starts).toEqual([expiredAttemptId, expect.any(String)]);
	expect(starts[1]).not.toBe(expiredAttemptId);
	expect(readUpdateAttempt(directory)).toMatchObject({ requestId, attemptId: starts[1] });
	expect(await readFile(service.binary, "utf8")).toBe(binary);
});

test("reports failed staging while a backup is active without starting the update", async () => {
	vi.stubEnv("ZEROBYTE_AGENT_VERSION", "v1.0.0");
	const requestId = randomUUID();
	const jobs = createUpdateJobs();
	expect(jobs.admit("schedule-1")).toBeUndefined();

	const actions: string[] = [];
	const failures: object[] = [];
	vi.stubGlobal("fetch", async (url: URL, options: RequestInit) => {
		if (url.hostname !== "controller.example") return new Response("invalid attestation");

		const request = JSON.parse(typeof options.body === "string" ? options.body : "");
		actions.push(request.action);
		if (request.action === "poll") return Response.json({ update: { requestId, status: "queued", target } });

		failures.push(request);
		return failures.length === 1 ? new Response(null, { status: 409 }) : Response.json({ update: null });
	});

	await Effect.runPromise(
		Effect.gen(function* () {
			const updater = yield* Effect.forkChild(
				runSelfUpdate({ binary: join(directory, "agent"), directory }, configuration, jobs),
			);
			yield* TestClock.adjust("15 seconds");
			yield* Fiber.interrupt(updater);
		}).pipe(Effect.provide(TestClock.layer())),
	);

	expect(actions).toEqual(["poll", "failPreparation", "poll", "failPreparation"]);
	expect(failures).toEqual([{ action: "failPreparation", requestId, attemptId: expect.any(String) }, failures[0]]);
	expect(readLocalUpdateState(directory)).toMatchObject({ phase: "idle" });
	jobs.finish("schedule-1");
});

test("an unreadable trial record cannot advertise readiness or remove the rollback marker", async () => {
	vi.stubEnv("ZEROBYTE_AGENT_VERSION", target.tag);
	await writeFile(join(directory, "attempt.json"), "{");
	const idle = readLocalUpdateState(directory);
	expect(idle).toMatchObject({ phase: "invalid", trial: false });
	expect(getLocalUpdateTrial(idle)).toBeUndefined();

	const trial = join(directory, "trial");
	await writeFile(trial, "previous build");
	const state = readLocalUpdateState(directory);
	expect(state).toMatchObject({ phase: "invalid", trial: true });
	expect(getLocalUpdateTrial(state)).toBeUndefined();

	const fetch = vi.fn();
	vi.stubGlobal("fetch", fetch);
	const service = { binary: join(directory, "agent"), directory };
	const startedAt = await Effect.runPromise(Clock.monotonicTimeNanos);
	expect(Exit.isFailure(await Effect.runPromiseExit(confirmUpdateTrial(service, configuration, startedAt)))).toBe(
		true,
	);
	expect(fetch).not.toHaveBeenCalled();
	expect(await readFile(trial, "utf8")).toBe("previous build");
});

test("replays a missed rollback acknowledgment across restarts, then stages the same release on a fresh attempt", async () => {
	vi.stubEnv("ZEROBYTE_AGENT_VERSION", "v1.0.0");
	const requestId = randomUUID();
	const attemptId = randomUUID();
	const retryId = randomUUID();
	const signedTarget = { ...target, sha256: { x64: target.sha256.arm64, arm64: target.sha256.arm64 } };
	const bytes = Buffer.from(JSON.stringify(signedTarget));
	saveUpdateAttempt(directory, { requestId, attemptId, target: signedTarget, failed: false });
	await writeFile(join(directory, "failed"), "previous executable");
	const service = { binary: join(directory, "agent"), directory };
	await writeFile(service.binary, "installed");

	let rollbackReports = 0;
	vi.stubGlobal("fetch", async (url: URL, options: RequestInit) => {
		if (url.pathname.endsWith(AGENT_RELEASE_ATTESTATION_ASSET)) return new Response(bytes);
		if (url.hostname !== "controller.example") return new Response(binary);

		const request = JSON.parse(typeof options.body === "string" ? options.body : "");
		if (request.action === "fail") {
			expect(request).toEqual({ action: "fail", requestId, attemptId });
			if (++rollbackReports === 1) throw new Error("response lost");
			if (rollbackReports === 2) return new Response(null, { status: 409 });
			return Response.json({ update: null });
		}
		if (request.action === "poll") {
			return Response.json({ update: { requestId: retryId, status: "queued", target: signedTarget } });
		}

		expect(request).toMatchObject({ action: "start", requestId: retryId });
		expect(request.attemptId).not.toBe(attemptId);
		return Response.json({ update: { requestId: retryId, status: "started", target: signedTarget } });
	});

	const runUntil = async (check: () => void) => {
		const shutdown = new AbortController();
		const running = Effect.runPromiseExit(runSelfUpdate(service, configuration, createUpdateJobs()), {
			signal: shutdown.signal,
		});
		try {
			await vi.waitFor(check);
		} finally {
			shutdown.abort();
			await running;
		}
	};

	await runUntil(() => expect(rollbackReports).toBe(1));
	expect(readUpdateAttempt(directory)).toMatchObject({ requestId, attemptId });
	expect(await Bun.file(join(directory, "failed")).exists()).toBe(true);

	await runUntil(() => expect(rollbackReports).toBe(2));
	expect(readUpdateAttempt(directory)).toMatchObject({ requestId, attemptId });
	expect(await Bun.file(join(directory, "failed")).exists()).toBe(true);

	await runUntil(() => expect(readUpdateAttempt(directory)).toBeUndefined());
	expect(await Bun.file(join(directory, "failed")).exists()).toBe(false);

	expect(await Effect.runPromise(runSelfUpdate(service, configuration, createUpdateJobs()))).toBe(true);
	expect(rollbackReports).toBe(3);
	expect(readUpdateAttempt(directory)).toMatchObject({ requestId: retryId });
});

test.each([200, 410])(
	"retains local acceptance through a lost response and 409, then reconciles on %s",
	async (finalStatus) => {
		vi.stubEnv("ZEROBYTE_AGENT_VERSION", target.tag);
		const attempt = {
			requestId: randomUUID(),
			attemptId: randomUUID(),
			target,
			failed: false,
			confirmed: true as const,
		};
		saveUpdateAttempt(directory, attempt);
		const jobs = createUpdateJobs();
		let acknowledgments = 0;

		vi.stubGlobal("fetch", async (_url: URL, options: RequestInit) => {
			expect(JSON.parse(typeof options.body === "string" ? options.body : "")).toEqual({
				action: "accept",
				requestId: attempt.requestId,
				attemptId: attempt.attemptId,
			});
			expect(jobs.admit("schedule-1")).toBeUndefined();
			jobs.finish("schedule-1");

			if (++acknowledgments === 1) throw new Error("response lost");
			if (acknowledgments === 2) return new Response(null, { status: 409 });
			return Response.json({ update: null }, { status: finalStatus });
		});

		await Effect.runPromise(
			Effect.gen(function* () {
				const updater = yield* Effect.forkChild(
					runSelfUpdate({ binary: join(directory, "agent"), directory }, configuration, jobs),
				);
				yield* TestClock.adjust("15 seconds");
				expect(readUpdateAttempt(directory)).toMatchObject(attempt);
				yield* TestClock.adjust("15 seconds");
				yield* Fiber.interrupt(updater);
			}).pipe(Effect.provide(TestClock.layer())),
		);
		expect(acknowledgments).toBe(3);
		expect(readUpdateAttempt(directory)).toBeUndefined();
	},
);

test("cancels a stalled attestation before downloading the executable", async () => {
	const cancel = vi.fn(() => new Promise<void>(() => {}));
	const body = new ReadableStream<Uint8Array>({ cancel });
	const fetch = vi.fn(async () => new Response(body));
	vi.stubGlobal("fetch", fetch);

	const shutdown = new AbortController();
	const staged = join(directory, "staged");
	const result = Effect.runPromiseExit(stageUpdate(target, "v1.0.0", "arm64", staged), { signal: shutdown.signal });
	try {
		await vi.waitFor(() => expect(body.locked).toBe(true));
	} finally {
		shutdown.abort();
	}

	expect(Exit.isFailure(await result)).toBe(true);
	expect(fetch).toHaveBeenCalledOnce();
	expect(cancel).toHaveBeenCalledOnce();
	expect(body.locked).toBe(false);
	expect(await Bun.file(staged).exists()).toBe(false);
});

test("interrupts a stalled binary body and removes the staging file without awaiting cancellation", async () => {
	const bytes = Buffer.from(JSON.stringify(target));
	const cancel = vi.fn(() => new Promise<void>(() => {}));
	const body = new ReadableStream<Uint8Array>({
		start(controller) {
			controller.enqueue(Buffer.from(binary));
		},
		cancel,
	});

	vi.stubGlobal("fetch", async (url: URL) => {
		if (url.pathname.endsWith(AGENT_RELEASE_ATTESTATION_ASSET)) return new Response(bytes);
		return new Response(body);
	});

	const staged = join(directory, "staged");
	const shutdown = new AbortController();
	const result = Effect.runPromiseExit(stageUpdate(target, "v1.0.0", "arm64", staged), { signal: shutdown.signal });
	try {
		await vi.waitFor(async () => {
			expect(body.locked).toBe(true);
			expect(await readFile(staged, "utf8")).toBe(binary);
		});
	} finally {
		shutdown.abort();
	}

	expect(Exit.isFailure(await result)).toBe(true);
	expect(cancel).toHaveBeenCalledOnce();
	expect(body.locked).toBe(false);
	expect(await Bun.file(staged).exists()).toBe(false);
});

test("reads additive attempt metadata while keeping the rollback record compatible with the restored executable", async () => {
	const restoredAttemptSchema = z.strictObject({
		requestId: z.uuid(),
		attemptId: z.uuid(),
		target: agentReleaseManifestSchema,
		failed: z.boolean(),
	});
	const attempt = { requestId: randomUUID(), attemptId: randomUUID(), target, failed: false };
	const additiveAttempt = { ...attempt, futureField: true };
	saveUpdateAttempt(directory, additiveAttempt);
	expect(readUpdateAttempt(directory)).toEqual(attempt);

	saveUpdateAttempt(directory, attempt);
	saveUpdateAttempt(directory, attempt, "confirmed");
	const persisted = JSON.parse(await readFile(join(directory, "attempt.json"), "utf8"));
	expect(restoredAttemptSchema.parse(persisted)).toEqual(attempt);
	expect(readUpdateAttempt(directory)).toEqual({ ...attempt, confirmed: true });

	vi.stubEnv("ZEROBYTE_AGENT_VERSION", target.tag);
	await writeFile(join(directory, "failed"), "restored executable");
	const fetch = vi.fn(async (_url: URL, options: RequestInit) => {
		expect(JSON.parse(typeof options.body === "string" ? options.body : "")).toEqual({
			action: "fail",
			requestId: attempt.requestId,
			attemptId: attempt.attemptId,
		});
		return Response.json({ update: null });
	});
	vi.stubGlobal("fetch", fetch);
	const shutdown = new AbortController();
	const service = { binary: join(directory, "agent"), directory };
	const running = Effect.runPromiseExit(runSelfUpdate(service, configuration, createUpdateJobs()), {
		signal: shutdown.signal,
	});
	try {
		await vi.waitFor(() => expect(readUpdateAttempt(directory)).toBeUndefined());
	} finally {
		shutdown.abort();
		await running;
	}

	expect(fetch).toHaveBeenCalledOnce();
	expect(await Bun.file(join(directory, "failed")).exists()).toBe(false);
	expect(await Bun.file(join(directory, "confirmed.json")).exists()).toBe(false);
});

test.each(["stop", "start", "swap interrupted before rename", "atomic replacement failure"])(
	"recovers the previous executable after %s",
	async (failure) => {
		const updateDirectory = join(directory, "update");
		const installed = join(directory, "agent");
		const staged = join(updateDirectory, "staged");
		const recovery = join(updateDirectory, "recover");
		const sync = join(directory, "sync");

		await mkdir(updateDirectory);
		await writeFile(staged, "new");
		await writeFile(installed, "old");
		await writeFile(recovery, systemdRecoveryScript, { mode: 0o700 });
		await writeFile(sync, "#!/bin/sh\nexit 0\n", { mode: 0o700 });
		const hook = (phase: string) => {
			const result = Bun.spawnSync([recovery, installed, phase], { env: { PATH: `${directory}:/bin:/usr/bin` } });
			expect(result.stderr.toString()).toBe("");
			expect(result.exitCode).toBe(0);
		};

		const swap = () => commitSystemdUpdate({ binary: installed, directory: updateDirectory }, staged);
		if (failure === "atomic replacement failure") {
			await rm(staged);
			expect(swap).toThrow();
			expect(await Bun.file(join(updateDirectory, "pending")).exists()).toBe(false);
		} else if (failure === "swap interrupted before rename") {
			await link(installed, join(updateDirectory, "pending"));
			hook("start");
			expect(await readFile(join(updateDirectory, "failed"), "utf8")).toBe("old");
			expect(await Bun.file(join(updateDirectory, "trial")).exists()).toBe(false);
		} else {
			swap();
			hook("stop");
			expect(await readFile(installed, "utf8")).toBe("new");

			hook("start");
			expect(await readFile(join(updateDirectory, "trial"), "utf8")).toBe("old");
			hook(failure);
			expect(await readFile(join(updateDirectory, "failed"), "utf8")).toBe("old");
		}

		expect(await readFile(installed, "utf8")).toBe("old");
	},
);

test.each([
	"accepted",
	"timeout",
	"notify failed",
	"wrong build",
	"unauthorized",
	"unavailable",
	"near cutoff",
	"past cutoff",
])("keeps the rollback binary until controller confirmation and local readiness succeed (%s)", async (outcome) => {
	const trial = join(directory, "trial");
	const notifier = join(directory, "systemd-notify");
	const requestId = randomUUID();
	const attemptId = randomUUID();
	saveUpdateAttempt(directory, { requestId, attemptId, target, failed: false });
	await writeFile(trial, "previous build");
	await writeFile(notifier, `#!/bin/sh\nexit ${outcome === "notify failed" ? 1 : 0}\n`, { mode: 0o700 });
	vi.stubEnv("PATH", `${directory}:/bin:/usr/bin`);
	vi.stubEnv("NOTIFY_SOCKET", "/test/notify");
	vi.stubEnv("ZEROBYTE_AGENT_VERSION", outcome === "wrong build" ? "v1.0.0" : target.tag);
	const service = { binary: join(directory, "agent"), directory };

	let confirmations = 0;
	vi.stubGlobal("fetch", async (_url: URL, options: RequestInit) => {
		expect(JSON.parse(typeof options.body === "string" ? options.body : "")).toEqual({
			action: "confirm",
			requestId,
			attemptId,
		});
		expect(readFileSync(trial, "utf8")).toBe("previous build");
		confirmations++;
		if (outcome === "unauthorized") return new Response(null, { status: 401 });
		if (outcome === "unavailable" && confirmations === 1) return new Response(null, { status: 503 });
		if (confirmations === 1 || outcome === "timeout" || (outcome === "past cutoff" && confirmations < 3)) {
			return new Response(null, { status: 409 });
		}
		return Response.json({ update: null });
	});

	const result = await Effect.runPromise(
		Effect.gen(function* () {
			const startedAt = yield* Clock.monotonicTimeNanos;
			if (outcome === "near cutoff") yield* TestClock.adjust("31 seconds");
			if (outcome === "past cutoff") yield* TestClock.adjust(31_500);

			const fiber = yield* Effect.forkChild(confirmUpdateTrial(service, configuration, startedAt));
			const advance = outcome === "near cutoff" || outcome === "past cutoff" ? "2 seconds" : "41 seconds";
			yield* TestClock.adjust(advance);
			return yield* Fiber.await(fiber);
		}).pipe(Effect.provide(TestClock.layer())),
	);

	const accepted = outcome === "accepted" || outcome === "unavailable" || outcome === "near cutoff";
	expect(Exit.isSuccess(result)).toBe(accepted);
	expect(await Bun.file(trial).exists()).toBe(!accepted);
	if (accepted || outcome === "notify failed") {
		expect(readUpdateAttempt(directory)?.confirmed).toBe(true);
		expect(JSON.parse(await readFile(join(directory, "attempt.json"), "utf8"))).toEqual({
			requestId,
			attemptId,
			target,
			failed: false,
		});
	}
	if (outcome === "wrong build") expect(confirmations).toBe(0);
	else if (outcome === "unauthorized") expect(confirmations).toBe(1);
	else if (outcome === "past cutoff") expect(confirmations).toBe(2);
	else expect(confirmations).toBeGreaterThanOrEqual(2);
});

test("local readiness can be sent independently of updater eligibility", async () => {
	const notifier = join(directory, "systemd-notify");
	await writeFile(notifier, '#!/bin/sh\n[ "$1" = --ready ]\n', { mode: 0o700 });
	vi.stubEnv("PATH", `${directory}:/bin:/usr/bin`);
	vi.stubEnv("NOTIFY_SOCKET", "/test/notify");

	await expect(Effect.runPromise(notifySystemdReady)).resolves.toBeUndefined();
});

test("interrupts systemd notification without losing the trial marker", async () => {
	const notifier = join(directory, "systemd-notify");
	const invoked = join(directory, "invoked");
	const trial = join(directory, "trial");
	const attempt = { requestId: randomUUID(), attemptId: randomUUID(), target, failed: false };
	saveUpdateAttempt(directory, attempt);
	await writeFile(trial, "previous build");
	await writeFile(notifier, '#!/bin/sh\n: > "$NOTIFIER_MARKER"\nexec /bin/sleep 30\n', { mode: 0o700 });
	vi.stubEnv("PATH", `${directory}:/bin:/usr/bin`);
	vi.stubEnv("NOTIFY_SOCKET", "/test/notify");
	vi.stubEnv("NOTIFIER_MARKER", invoked);
	vi.stubEnv("ZEROBYTE_AGENT_VERSION", target.tag);
	vi.stubGlobal("fetch", async () => Response.json({ update: null }));

	const shutdown = new AbortController();
	const service = { binary: join(directory, "agent"), directory };
	const startedAt = await Effect.runPromise(Clock.monotonicTimeNanos);
	const result = Effect.runPromiseExit(confirmUpdateTrial(service, configuration, startedAt), {
		signal: shutdown.signal,
	});
	try {
		await vi.waitFor(async () => expect(await Bun.file(invoked).exists()).toBe(true));
	} finally {
		shutdown.abort();
	}

	expect(Exit.isFailure(await result)).toBe(true);
	expect(await Bun.file(trial).exists()).toBe(true);
	expect(readUpdateAttempt(directory)).toEqual({ ...attempt, confirmed: true });
});

test.each([
	["0::/system.slice/zerobyte-agent.service", true],
	["0::/backup.slice/backup-nightly.slice/zerobyte-agent.service", true],
	["1:name=systemd:/backup.slice/zerobyte-agent.service", true],
	["0::/system.slice/other.service/backup.slice/zerobyte-agent.service", false],
	["0::/user.slice/user-1000.slice/user@1000.service/zerobyte-agent.service", false],
	["2:memory:/system.slice/zerobyte-agent.service", false],
])("validates installed service cgroup %s", (cgroup, eligible) => {
	expect(isSystemdServiceCgroup(cgroup)).toBe(eligible);
});
