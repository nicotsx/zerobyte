import { dehydrate, hydrate, QueryClient } from "@tanstack/react-query";
import { expect, test, vi } from "vitest";
import { client } from "~/client/api-client/client.gen";
import { createClient } from "~/client/api-client/client";
import { getSystemInfoOptions, getSystemInfoQueryKey } from "~/client/api-client/@tanstack/react-query.gen";
import { createRequestClient, runWithRequestClient } from "~/lib/request-client";

test("reuses SSR system info after hydration while requests retain their own URL and cookies", async () => {
	const originalConfig = client.getConfig();
	const baseUrl = "https://zerobyte.example";
	const serverCache = new QueryClient();
	const browserCache = new QueryClient();
	const systemInfo = {
		runtime: "desktop",
		capabilities: { rclone: false, sysAdmin: false, volumeBackends: ["directory"], repositoryBackends: ["local"] },
	};
	const requests: Request[] = [];
	const fetch = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
		const request = new Request(input, init);
		requests.push(request);
		return Response.json(systemInfo);
	});
	const serverClient = createRequestClient({ baseUrl, headers: { cookie: "session=ssr" } }, "http://127.0.0.1:54321");

	try {
		client.setConfig({ baseUrl });
		await runWithRequestClient(serverClient, () => serverCache.fetchQuery(getSystemInfoOptions()));
		const serializedCache = JSON.stringify(dehydrate(serverCache));
		hydrate(browserCache, JSON.parse(serializedCache));

		expect(browserCache.getQueryData(getSystemInfoQueryKey())).toEqual(systemInfo);
		expect(requests[0]?.url).toBe("http://127.0.0.1:54321/api/v1/system/info");
		expect(requests[0]?.headers.get("cookie")).toBe("session=ssr");
		expect(serializedCache).not.toContain("127.0.0.1");
		expect(serializedCache).not.toContain("session=ssr");

		await browserCache.ensureQueryData(getSystemInfoOptions());
		expect(fetch).toHaveBeenCalledTimes(1);
		await browserCache.fetchQuery(getSystemInfoOptions());
		expect(requests[1]?.url).toBe("https://zerobyte.example/api/v1/system/info");
		expect(requests[1]?.headers.has("cookie")).toBe(false);
	} finally {
		fetch.mockRestore();
		client.setConfig(originalConfig);
		serverCache.clear();
		browserCache.clear();
	}
});

test("keeps explicitly selected API origins in separate caches", () => {
	const cache = new QueryClient();
	const baseUrl = "https://another-api.example";
	const explicitClient = createClient({ baseUrl });
	cache.setQueryData(getSystemInfoQueryKey({ baseUrl }), { runtime: "desktop" });

	expect(cache.getQueryData(getSystemInfoQueryKey({ client: explicitClient }))).toEqual({ runtime: "desktop" });
	expect(cache.getQueryData(getSystemInfoQueryKey())).toBeUndefined();
	cache.clear();
});

test.each(["http://127.0.0.1", "http://127.0.0.1:54321"])(
	"routes requests to %s without losing the body, query, headers or cancellation",
	async (internalOrigin) => {
		const controller = new AbortController();
		const requests: Request[] = [];
		const fetch = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
			requests.push(new Request(input, init));
			return Response.json({ ok: true });
		});
		const serverClient = createRequestClient({ baseUrl: "https://zerobyte.example:8536" }, internalOrigin);

		try {
			await serverClient.post({
				url: "/api/test?filter=a%2Fb",
				body: { value: "payload" },
				headers: { "Content-Type": "application/json", cookie: "session=ssr" },
				signal: controller.signal,
				throwOnError: true,
			});
			expect(requests[0]?.url).toBe(`${internalOrigin}/api/test?filter=a%2Fb`);
			expect(requests[0]?.method).toBe("POST");
			expect(await requests[0]?.json()).toEqual({ value: "payload" });
			expect(requests[0]?.headers.get("Content-Type")).toBe("application/json");
			expect(requests[0]?.headers.get("cookie")).toBe("session=ssr");
			controller.abort();
			expect(requests[0]?.signal.aborted).toBe(true);

			await serverClient.get({ baseUrl: "https://other.example", url: "/api/test", throwOnError: true });
			expect(requests[1]?.url).toBe("https://other.example/api/test");
		} finally {
			fetch.mockRestore();
		}
	},
);
