import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { Effect, Fiber } from "effect";
import { TestClock } from "effect/testing";
import { afterEach, expect, test, vi } from "vitest";
import { enrollMachine, parseControllerUrl, reconnectMachine } from "../enrollment";
import { runTest } from "./effect-test-support";

const directories: string[] = [];
const controller = new URL("https://controller.example");
const code = "zba1.machine.2.one-time-secret";

afterEach(async () => {
	vi.unstubAllGlobals();
	await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

const machineToken = (agentId: string, version: number) => `zba1.${agentId}.${version}.secret-${version}`;

const failure = (effect: Parameters<typeof runTest>[0]) => runTest(effect).catch((error: Error) => error.message);

test.each([
	{ url: "https://controller.example", allowInsecure: false, valid: true },
	{ url: "http://controller.example", allowInsecure: false, valid: false },
	{ url: "http://controller.example", allowInsecure: true, valid: true },
	{ url: "https://user:secret@controller.example", allowInsecure: false, valid: false },
	{ url: "wss://controller.example", allowInsecure: true, valid: false },
	{ url: "not a url", allowInsecure: false, valid: false },
])("controller URL $url with allowInsecure=$allowInsecure is valid: $valid", async ({ url, allowInsecure, valid }) => {
	const result = runTest(parseControllerUrl(url, allowInsecure));

	if (valid) await expect(result).resolves.toBeInstanceOf(URL);
	else await expect(result).rejects.toMatchObject({ _tag: "EnrollmentError" });
});

test("enrollment exchanges the code for a credential and derives the connection URL", async () => {
	const folder = await mkdtemp(path.join(tmpdir(), "zerobyte-enrollment-"));
	directories.push(folder);
	const request = vi.fn(async () => Response.json({ token: "machine-credential" }));
	vi.stubGlobal("fetch", request);

	const configuration = await runTest(enrollMachine(controller, code, [folder]));

	expect(configuration).toEqual({
		controllerUrl: "wss://controller.example/api/v1/agents/connect",
		token: "machine-credential",
		roots: [{ id: "files-1", label: "Files 1", path: folder, allowBackup: true }],
	});
	expect(request).toHaveBeenCalledOnce();
});

test("an HTTP development controller produces a plaintext connection URL", async () => {
	vi.stubGlobal("fetch", async () => Response.json({ token: "machine-credential" }));

	const configuration = await runTest(enrollMachine(new URL("http://192.168.1.10:8080"), code, []));

	expect(configuration.controllerUrl).toBe("ws://192.168.1.10:8080/api/v1/agents/connect");
});

test("missing folders fail before the code is exchanged", async () => {
	const request = vi.fn();
	vi.stubGlobal("fetch", request);

	await expect(runTest(enrollMachine(controller, code, ["/definitely/missing"]))).rejects.toThrow(
		"cannot be resolved",
	);
	expect(request).not.toHaveBeenCalled();
});

test("TLS rejection explains the proxy settings without blaming the connection code", async () => {
	vi.stubGlobal("fetch", async () => Response.json({ message: "TLS required" }, { status: 426 }));

	const message = await failure(enrollMachine(controller, code, []));

	expect(message).toContain("426");
	expect(message).toContain("TRUST_PROXY=true");
	expect(message).toContain("not consumed");
});

test("controller errors keep the server's explanation while redacting the submitted code", async () => {
	vi.stubGlobal("fetch", async () =>
		Response.json({ message: `Remote agents are disabled. Submitted code: ${code}` }, { status: 503 }),
	);

	const message = await failure(enrollMachine(controller, code, []));

	expect(message).toContain("Remote agents are disabled");
	expect(message).toContain("ENABLE_REMOTE_AGENTS=true");
	expect(message).not.toContain(code);
});

test("proxy error pages and login pages never leak their body", async () => {
	vi.stubGlobal("fetch", async () => new Response("<html>private-proxy-debug</html>", { status: 502 }));
	const proxyError = await failure(enrollMachine(controller, code, []));
	expect(proxyError).toContain("502");
	expect(proxyError).toMatch(/proxy.*logs/i);
	expect(proxyError).not.toContain("private-proxy-debug");

	vi.stubGlobal("fetch", async () => new Response("<html>private-login-page</html>", { status: 200 }));
	const loginPage = await failure(enrollMachine(controller, code, []));
	expect(loginPage).toContain("invalid machine credential");
	expect(loginPage).not.toContain("private-login-page");
});

test("network failures identify the controller without exposing the code", async () => {
	vi.stubGlobal("fetch", async () => {
		throw new TypeError(`Unable to connect: ${code}`);
	});

	const message = await failure(enrollMachine(controller, code, []));

	expect(message).toContain("https://controller.example");
	expect(message).not.toContain(code);
});

test.each(["headers", "body"])("enrollment times out and aborts while waiting for response %s", async (stage) => {
	const started = Promise.withResolvers<void>();
	const request = vi.fn(async (_input: string | URL, options?: RequestInit) => {
		if (stage === "headers") {
			started.resolve();
			return new Promise<Response>((_resolve, reject) => {
				options?.signal?.addEventListener("abort", () => reject(options.signal?.reason), { once: true });
			});
		}

		return new Response(
			new ReadableStream(
				{
					start(body) {
						body.enqueue(new TextEncoder().encode('{"token":'));
						options?.signal?.addEventListener("abort", () => body.error(options.signal?.reason), {
							once: true,
						});
					},
					pull() {
						started.resolve();
					},
				},
				{ highWaterMark: 0 },
			),
		);
	});
	vi.stubGlobal("fetch", request);

	const enrollment = Effect.gen(function* () {
		const fiber = yield* Effect.forkChild(enrollMachine(controller, code, []));

		yield* Effect.promise(() => started.promise);
		yield* TestClock.adjust("15 seconds");

		return yield* Fiber.join(fiber);
	}).pipe(Effect.provide(TestClock.layer()));

	await expect(runTest(enrollment)).rejects.toMatchObject({
		_tag: "EnrollmentError",
		message: "Enrollment request to https://controller.example timed out. Check network access.",
	});
	expect(request.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
});

const saved = {
	controllerUrl: "wss://old-controller.example/api/v1/agents/connect",
	token: machineToken("machine", 1),
	roots: [{ id: "data", label: "Data", path: "/srv/data", allowBackup: false }],
	controllerSessionId: "preserved",
};

test("reconnection replaces the credential and address while preserving folders", async () => {
	vi.stubGlobal("fetch", async () => Response.json({ token: machineToken("machine", 3) }));

	await expect(runTest(reconnectMachine(saved, controller, machineToken("machine", 2)))).resolves.toEqual({
		...saved,
		controllerUrl: "wss://controller.example/api/v1/agents/connect",
		token: machineToken("machine", 3),
	});
});

test.each([machineToken("another-machine", 2), "not-a-code"])(
	"a code for another machine is refused before it is exchanged: %s",
	async (otherCode) => {
		const request = vi.fn();
		vi.stubGlobal("fetch", request);

		await expect(runTest(reconnectMachine(saved, controller, otherCode))).rejects.toThrow("different machine");
		expect(request).not.toHaveBeenCalled();
	},
);

test("a credential issued for another machine is refused", async () => {
	vi.stubGlobal("fetch", async () => Response.json({ token: machineToken("another-machine", 3) }));

	await expect(runTest(reconnectMachine(saved, controller, machineToken("machine", 2)))).rejects.toThrow(
		"Controller returned a credential for a different machine",
	);
});
