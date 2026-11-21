import { Effect, Fiber } from "effect";
import { expect, test, vi } from "vitest";
import { parseAgentMessage } from "@zerobyte/contracts/agent-protocol";
import { runAgent } from "../agent";
import { CONTROLLER_SILENCE_TIMEOUT_MS } from "../controller-session";

const waitForReadiness = async (ready: () => boolean) => {
	for (let attempts = 0; attempts < 100 && !ready(); attempts++) {
		await Bun.sleep(10);
	}

	expect(ready()).toBe(true);
};

test("a silent WebSocket is replaced and the agent announces readiness again", async () => {
	vi.useFakeTimers({ toFake: ["Date", "performance", "setTimeout", "clearTimeout"] });
	const readySockets = new Set<Bun.ServerWebSocket<unknown>>();
	const server = Bun.serve({
		hostname: "127.0.0.1",
		port: 0,
		fetch(request, listener) {
			if (listener.upgrade(request)) return;
			return new Response(null, { status: 400 });
		},
		websocket: {
			idleTimeout: 0,
			message(socket, message) {
				const parsed = parseAgentMessage(String(message));

				if (parsed?.success && parsed.data.type === "agent.ready") readySockets.add(socket);
			},
		},
	});

	const agent = Effect.runFork(
		runAgent({
			configuration: { controllerUrl: `ws://127.0.0.1:${server.port}/agents/connect`, roots: [], token: "test" },
			builtinLocal: true,
			resticVersion: "0.18.1",
		}),
	);

	try {
		await waitForReadiness(() => readySockets.size === 1);
		await vi.advanceTimersByTimeAsync(CONTROLLER_SILENCE_TIMEOUT_MS - 1);

		expect(readySockets.size).toBe(1);

		await vi.advanceTimersByTimeAsync(2_001);
		await waitForReadiness(() => readySockets.size === 2);
	} finally {
		await Effect.runPromise(Fiber.interrupt(agent));
		await server.stop(true);
		vi.useRealTimers();
	}
});
