import { expect, test, vi } from "vitest";

type ApiHandler = (context: { request: Request }) => Promise<Response> | Response;

const fetch = vi.hoisted(() => vi.fn<(request: Request) => Response>(() => new Response("ok")));

vi.mock("~/server/app", () => ({
	createApp: () => ({ fetch }),
}));

vi.mock("~/server/core/config", () => ({
	config: {
		serverIdleTimeout: 255,
		trustProxy: false,
	},
}));

const { Route } = await import("./api.$");
const server = Route.options.server;

if (!server || !server.handlers || typeof server.handlers === "function") {
	throw new Error("API route must define static server handlers");
}

const routeHandler = Reflect.get(server.handlers, "ANY");

if (typeof routeHandler !== "function") {
	throw new Error("API route must define an ANY handler");
}

const handle = routeHandler as ApiHandler;

test("sets runtime timeouts before cloning an API request", async () => {
	const setTimeout = vi.fn();
	const timeout = vi.fn();
	const request = new Request("http://zerobyte.test/api/backups");
	const runtime = {
		node: { res: { setTimeout } },
		bun: { server: { timeout } },
	};

	Object.assign(request, { runtime });

	await handle({ request });

	expect(setTimeout).toHaveBeenCalledWith(255_000);
	expect(timeout).toHaveBeenCalledWith(request, 255);
	expect(fetch).toHaveBeenCalledOnce();
	const preparedRequest = fetch.mock.calls[0]?.[0];
	expect(preparedRequest).not.toBe(request);
});
