import { describe, expect, test } from "vitest";
import { getIsSecureContextForRequest, isSecureContextOrigin } from "../is-secure-context";

describe("isSecureContextOrigin", () => {
	test("treats HTTPS and loopback HTTP origins as secure contexts", () => {
		expect(isSecureContextOrigin("https://example.com")).toBe(true);
		expect(isSecureContextOrigin("http://localhost:3000")).toBe(true);
		expect(isSecureContextOrigin("http://app.localhost")).toBe(true);
		expect(isSecureContextOrigin("http://127.0.0.1:3000")).toBe(true);
		expect(isSecureContextOrigin("http://[::1]:3000")).toBe(true);
	});

	test("treats non-local HTTP origins as insecure contexts", () => {
		expect(isSecureContextOrigin("http://example.com")).toBe(false);
		expect(isSecureContextOrigin("http://127.example.com")).toBe(false);
	});
});

describe("getIsSecureContextForRequest", () => {
	test("uses forwarded protocol and host when present", () => {
		const request = new Request("http://internal.local/settings", {
			headers: {
				host: "internal.local",
				"x-forwarded-host": "zerobyte.example.com",
				"x-forwarded-proto": "https",
			},
		});

		expect(getIsSecureContextForRequest(request)).toBe(true);
	});

	test("uses the request URL when forwarded headers are absent", () => {
		expect(getIsSecureContextForRequest(new Request("http://zerobyte.example.com/settings"))).toBe(false);
		expect(getIsSecureContextForRequest(new Request("https://zerobyte.example.com/settings"))).toBe(true);
	});
});
