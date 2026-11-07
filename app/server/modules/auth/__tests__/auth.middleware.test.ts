import { Hono } from "hono";
import { describe, expect, test, vi } from "vitest";
import { createTestSession } from "~/test/helpers/auth";
import { auth } from "~/server/lib/auth";
import { config } from "~/server/core/config";
import { conditionalRequireAuth } from "../auth.middleware";

const PROTECTED_PATH = "/api/v1/protected";

const createTestApp = (shouldRequireAuth: boolean, handler: () => void) => {
	const app = new Hono();
	app.on(
		["GET", "POST", "PUT", "PATCH", "DELETE"],
		PROTECTED_PATH,
		conditionalRequireAuth(shouldRequireAuth),
		(c) => {
			handler();

			return c.text("OK");
		},
	);

	return app;
};

describe("conditionalRequireAuth", () => {
	test("rejects unauthenticated requests when authentication is required", async () => {
		const handler = vi.fn();
		const app = createTestApp(true, handler);

		const response = await app.request(PROTECTED_PATH);

		expect(response.status).toBe(401);
		expect(handler).not.toHaveBeenCalled();
	});

	test("runs the handler once for authenticated requests when authentication is required", async () => {
		const session = await createTestSession();
		const headers = new Headers(session.headers);
		headers.delete("origin");
		const handler = vi.fn();
		const app = createTestApp(true, handler);

		const response = await app.request(PROTECTED_PATH, { headers });

		expect(response.status).toBe(200);
		expect(handler).toHaveBeenCalledOnce();
	});

	test("runs the handler once without authentication when authentication is not required", async () => {
		const handler = vi.fn();
		const app = createTestApp(false, handler);

		const response = await app.request(PROTECTED_PATH);

		expect(response.status).toBe(200);
		expect(handler).toHaveBeenCalledOnce();
	});

	test("allows authenticated unsafe requests from a trusted origin", async () => {
		const session = await createTestSession();
		const handler = vi.fn();
		const app = createTestApp(true, handler);

		const response = await app.request(PROTECTED_PATH, { method: "POST", headers: session.headers });

		expect(response.status).toBe(200);
		expect(handler).toHaveBeenCalledOnce();
	});

	test.each(["https://evil.zerobyte.test", "null", "not-an-origin"])(
		"rejects authenticated unsafe requests from origin %s",
		async (origin) => {
			const session = await createTestSession();
			const handler = vi.fn();
			const app = createTestApp(true, handler);

			const response = await app.request(PROTECTED_PATH, {
				method: "POST",
				headers: { ...session.headers, Origin: origin },
			});

			expect(response.status).toBe(403);
			expect(await response.text()).toBe("Forbidden");
			expect(handler).not.toHaveBeenCalled();
		},
	);

	test("rejects authenticated unsafe requests without an origin", async () => {
		const session = await createTestSession();
		const headers = new Headers(session.headers);
		headers.delete("origin");
		const handler = vi.fn();
		const app = createTestApp(true, handler);

		const response = await app.request(PROTECTED_PATH, { method: "POST", headers });

		expect(response.status).toBe(403);
		expect(await response.text()).toBe("Forbidden");
		expect(handler).not.toHaveBeenCalled();
	});

	test("returns the authentication error before checking origin", async () => {
		const handler = vi.fn();
		const app = createTestApp(true, handler);

		const response = await app.request(PROTECTED_PATH, {
			method: "POST",
			headers: { Origin: "https://evil.zerobyte.test" },
		});

		expect(response.status).toBe(401);
		expect(await response.json()).toEqual({ message: "Invalid or expired session" });
		expect(handler).not.toHaveBeenCalled();
	});

	test.each(["POST", "PUT", "PATCH", "DELETE"])("rejects an untrusted form sent with %s", async (method) => {
		const session = await createTestSession();
		const handler = vi.fn();
		const app = createTestApp(true, handler);

		const response = await app.request(PROTECTED_PATH, {
			method,
			headers: {
				...session.headers,
				Origin: "https://evil.zerobyte.test",
				"Sec-Fetch-Site": "same-site",
				"Content-Type": "application/x-www-form-urlencoded",
			},
			body: "",
		});

		expect(response.status).toBe(403);
		expect(handler).not.toHaveBeenCalled();
	});

	test.each(["text/plain", "multipart/form-data", "application/x-www-form-urlencoded"])(
		"rejects an untrusted form with content type %s",
		async (contentType) => {
			const session = await createTestSession();
			const handler = vi.fn();
			const app = createTestApp(true, handler);

			const response = await app.request(PROTECTED_PATH, {
				method: "POST",
				headers: { ...session.headers, Origin: "https://evil.zerobyte.test", "Content-Type": contentType },
				body: "",
			});

			expect(response.status).toBe(403);
			expect(handler).not.toHaveBeenCalled();
		},
	);

	test.each([
		{ site: "same-origin", status: 200 },
		{ site: "same-site", status: 403 },
		{ site: "cross-site", status: 403 },
	])("uses fetch metadata when origin is absent: $site", async ({ site, status }) => {
		const session = await createTestSession();
		const headers = new Headers(session.headers);
		headers.delete("origin");
		headers.set("sec-fetch-site", site);
		const handler = vi.fn();
		const app = createTestApp(true, handler);

		const response = await app.request(PROTECTED_PATH, { method: "POST", headers });

		expect(response.status).toBe(status);
		expect(handler).toHaveBeenCalledTimes(status === 200 ? 1 : 0);
	});

	test("allows JSON requests without browser origin headers", async () => {
		const session = await createTestSession();
		const headers = new Headers(session.headers);
		headers.delete("origin");
		headers.set("content-type", "application/json");
		const handler = vi.fn();
		const app = createTestApp(true, handler);

		const response = await app.request(PROTECTED_PATH, { method: "POST", headers, body: "{}" });

		expect(response.status).toBe(200);
		expect(handler).toHaveBeenCalledOnce();
	});

	test("accepts configured public HTTPS origins through an HTTP upstream", async () => {
		const session = await createTestSession();
		const handler = vi.fn();
		const app = createTestApp(true, handler);
		const previousOrigins = config.trustedOrigins;
		const publicOrigins = ["https://backup.example.test", "https://alternate.example.test:8443"];
		config.trustedOrigins = [...previousOrigins, ...publicOrigins];

		try {
			for (const origin of publicOrigins) {
				const response = await app.request(`http://127.0.0.1:4096${PROTECTED_PATH}`, {
					method: "POST",
					headers: {
						...session.headers,
						Origin: origin,
						"Content-Type": "application/x-www-form-urlencoded",
						"X-Forwarded-Host": new URL(origin).host,
						"X-Forwarded-Proto": "https",
					},
					body: "",
				});

				expect(response.status).toBe(200);
			}

			expect(handler).toHaveBeenCalledTimes(publicOrigins.length);
		} finally {
			config.trustedOrigins = previousOrigins;
		}
	});

	test.each([
		{ origin: "http://localhost:3000", status: 200 },
		{ origin: "https://localhost:3000", status: 403 },
		{ origin: "https://tools.example.test", status: 200 },
		{ origin: "http://tools.example.test", status: 403 },
		{ origin: "http://192.168.1.50:4096", status: 200 },
		{ origin: "https://192.168.1.50:4096", status: 403 },
		{ origin: "http://192.168.1.50:4097", status: 403 },
		{ origin: "https://app.trusted.example.test:8443", status: 200 },
		{ origin: "http://app.trusted.example.test:8443", status: 403 },
		{ origin: "https://app.trusted.example.test:8444", status: 403 },
		{ origin: "https://app.trusted.example.test.attacker.test:8443", status: 403 },
		{ origin: "https://node1.patterns.example.test", status: 200 },
		{ origin: "https://node12.patterns.example.test", status: 403 },
		{ origin: "http://node1.patterns.example.test", status: 403 },
		{ origin: "http://app.legacy.example.test", status: 200 },
		{ origin: "https://app.legacy.example.test", status: 200 },
		{ origin: "/relative", status: 403 },
		{ origin: "//tools.example.test", status: 403 },
	])("honors explicit origin patterns for mixed domain and IP access: $origin", async ({ origin, status }) => {
		const session = await createTestSession();
		const handler = vi.fn();
		const app = createTestApp(true, handler);
		const previousOrigins = config.trustedOrigins;
		config.trustedOrigins = [
			"http://localhost:3000",
			"https://tools.example.test",
			"http://192.168.1.50:4096",
			"https://*.trusted.example.test:8443",
			"https://node?.patterns.example.test",
			"*.legacy.example.test",
		];

		try {
			const response = await app.request(PROTECTED_PATH, {
				method: "POST",
				headers: {
					...session.headers,
					Origin: origin,
					"Sec-Fetch-Site": "same-site",
					"Content-Type": "application/x-www-form-urlencoded",
				},
				body: "",
			});

			expect(response.status).toBe(status);
			expect(handler).toHaveBeenCalledTimes(status === 200 ? 1 : 0);
		} finally {
			config.trustedOrigins = previousOrigins;
		}
	});

	test("does not inherit an HTTP sibling origin inferred by authentication", async () => {
		const session = await createTestSession();
		const handler = vi.fn();
		const app = createTestApp(true, handler);
		const authContext = await auth.$context;
		const previousAuthOrigins = authContext.trustedOrigins;
		const previousOrigins = config.trustedOrigins;
		config.trustedOrigins = ["http://localhost:3000", "https://tools.example.test"];
		authContext.trustedOrigins = [
			...previousAuthOrigins,
			"https://tools.example.test",
			"http://tools.example.test",
		];

		try {
			const response = await app.request(`http://localhost:3000${PROTECTED_PATH}`, {
				method: "POST",
				headers: {
					...session.headers,
					Origin: "http://tools.example.test",
					"Sec-Fetch-Site": "same-site",
					"Content-Type": "application/x-www-form-urlencoded",
				},
				body: "",
			});

			expect(response.status).toBe(403);
			expect(handler).not.toHaveBeenCalled();
			expect(authContext.trustedOrigins).toEqual([
				...previousAuthOrigins,
				"https://tools.example.test",
				"http://tools.example.test",
			]);
		} finally {
			config.trustedOrigins = previousOrigins;
			authContext.trustedOrigins = previousAuthOrigins;
		}
	});

	test.each([
		{ pattern: "https://TOOLS.example.test:443/", origin: "https://tools.example.test", status: 200 },
		{ pattern: "https://TOOLS.example.test:443/", origin: "http://tools.example.test", status: 403 },
		{ pattern: "http://192.168.1.50:4096/", origin: "http://192.168.1.50:4096", status: 200 },
		{ pattern: "https://*.TRUSTED.example.test:443/", origin: "https://app.trusted.example.test", status: 200 },
		{ pattern: "https://*.TRUSTED.example.test:443/", origin: "http://app.trusted.example.test", status: 403 },
	])("normalizes $pattern without expanding schemes: $origin", async ({ pattern, origin, status }) => {
		const session = await createTestSession();
		const handler = vi.fn();
		const app = createTestApp(true, handler);
		const previousOrigins = config.trustedOrigins;
		config.trustedOrigins = [pattern];

		try {
			const response = await app.request(PROTECTED_PATH, {
				method: "POST",
				headers: { ...session.headers, Origin: origin },
			});

			expect(response.status).toBe(status);
			expect(handler).toHaveBeenCalledTimes(status === 200 ? 1 : 0);
		} finally {
			config.trustedOrigins = previousOrigins;
		}
	});

	test("allows authenticated API key requests without an origin", async () => {
		const session = await createTestSession();
		const apiKey = await auth.api.createApiKey({
			body: {
				name: "Middleware test",
				userId: session.user.id,
				metadata: { organizationId: session.organizationId },
				rateLimitEnabled: false,
			},
		});
		const handler = vi.fn();
		const app = createTestApp(true, handler);

		const response = await app.request(PROTECTED_PATH, {
			method: "POST",
			headers: { "x-api-key": apiKey.key },
		});

		expect(response.status).toBe(200);
		expect(handler).toHaveBeenCalledOnce();
	});
});
