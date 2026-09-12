import { afterEach, expect, test, vi } from "vitest";
import { getRequestClient } from "~/lib/request-client";

const { register, config } = vi.hoisted(() => ({
	register: vi.fn<(handler: (context: { next: () => Promise<void> }) => Promise<void>) => void>(),
	config: { runtime: "desktop", port: 54321 },
}));

vi.mock("@tanstack/react-start", () => ({
	createMiddleware: () => ({ server: register }),
}));
vi.mock("@tanstack/react-start/server", () => ({
	getRequestUrl: () => new URL("https://127.0.0.1:54321/volumes"),
	getRequestHeaders: () => new Headers({ cookie: "session=desktop" }),
}));
vi.mock("../../server/core/config", () => ({ config }));

await import("../api-client");
const run = register.mock.calls[0][0];

afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllEnvs();
	config.runtime = "desktop";
});

test("desktop SSR uses HTTPS with the launch certificate and preserves the session cookie", async () => {
	vi.stubEnv("NITRO_SSL_CERT", "launch-certificate");
	const network = vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ ok: true }));
	await run({
		next: async () => {
			await getRequestClient().get({ url: "/api/v1/system/info", throwOnError: true });
		},
	});
	const [input, options] = network.mock.calls[0];
	const request = new Request(input);
	expect(request.url).toBe("https://127.0.0.1:54321/api/v1/system/info");
	expect(request.headers.get("cookie")).toBe("session=desktop");
	expect(options).toEqual({ redirect: "error", tls: { ca: "launch-certificate" } });
});

test("desktop SSR fails before sending credentials when its certificate is missing", async () => {
	vi.stubEnv("NITRO_SSL_CERT", "");
	const network = vi.spyOn(globalThis, "fetch");
	await expect(
		run({
			next: async () => {
				await getRequestClient().get({ url: "/api/v1/system/info", throwOnError: true });
			},
		}),
	).rejects.toThrow("Desktop SSR is missing its TLS certificate");
	expect(network).not.toHaveBeenCalled();
});

test("server deployment continues to use internal HTTP", async () => {
	config.runtime = "server";
	const network = vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ ok: true }));
	await run({
		next: async () => {
			await getRequestClient().get({ url: "/api/v1/system/info", throwOnError: true });
		},
	});
	expect(new Request(network.mock.calls[0][0]).url).toBe("http://127.0.0.1:54321/api/v1/system/info");
});

test("explicit external API requests use normal certificate trust", async () => {
	const network = vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ ok: true }));
	await run({
		next: async () => {
			await getRequestClient().get({ baseUrl: "https://other.example", url: "/api/test", throwOnError: true });
		},
	});
	expect(new Request(network.mock.calls[0][0]).url).toBe("https://other.example/api/test");
	expect(network.mock.calls[0][1]).toBeUndefined();
});
