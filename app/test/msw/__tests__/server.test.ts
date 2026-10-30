import { afterAll, afterEach, beforeAll, expect, test } from "vitest";
import { http, HttpResponse, server } from "../server";

beforeAll(() => server.enable());
afterEach(() => server.resetHandlers());
afterAll(() => server.disable());

test("intercepts fetch requests with the shared test server", async () => {
	server.use(http.get("https://msw.invalid/response", () => HttpResponse.json({ intercepted: true })));

	const response = await fetch("https://msw.invalid/response");

	expect(response.status).toBe(200);
	expect(await response.json()).toEqual({ intercepted: true });
});

test("rejects requests without a handler instead of reaching the network", async () => {
	await expect(fetch("https://msw.invalid/unhandled")).rejects.toThrow("Cannot bypass a request");
});
