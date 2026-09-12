import { afterEach, expect, test, vi } from "vitest";
import { fromPartial } from "@total-typescript/shoehorn";
import { createPrivateKey, X509Certificate } from "node:crypto";
import { createDesktopTls } from "../desktop-tls";
import { createDesktopSession, launchSecretHeader } from "../desktop-session";

const { setCertificateVerifyProc, desktopFetch } = vi.hoisted(() => ({
	setCertificateVerifyProc: vi.fn<Electron.Session["setCertificateVerifyProc"]>(),
	desktopFetch: vi.fn<Electron.Session["fetch"]>(),
}));

vi.mock("electron", () => ({
	app: { getLocale: () => "en-GB" },
	session: {
		defaultSession: {
			setCertificateVerifyProc,
			fetch: desktopFetch,
		},
	},
}));

afterEach(() => vi.resetAllMocks());

test("trusts only this launch's certificate for loopback, even when another certificate is CA-trusted", async () => {
	const first = await createDesktopTls();
	const second = await createDesktopTls();
	const certificate = new X509Certificate(second.cert);
	expect(certificate.checkIP("127.0.0.1")).toBe("127.0.0.1");
	expect(certificate.checkPrivateKey(createPrivateKey(second.key))).toBe(true);
	expect(second.cert).not.toBe(first.cert);

	const verify = setCertificateVerifyProc.mock.calls[1][0];
	expect(verify).toBeTypeOf("function");
	if (!verify) throw new Error("Missing certificate verifier");

	for (const [data, result] of [
		[second.cert, 0],
		[first.cert, -2],
		["invalid certificate", -2],
	] as const) {
		const callback = vi.fn();
		verify(
			fromPartial({
				hostname: "127.0.0.1",
				certificate: { data },
				verificationResult: "OK",
				isIssuedByKnownRoot: true,
			}),
			callback,
		);
		expect(callback).toHaveBeenCalledExactlyOnceWith(result);
	}

	const callback = vi.fn();
	verify(fromPartial({ hostname: "example.com", certificate: { data: second.cert } }), callback);
	expect(callback).toHaveBeenCalledExactlyOnceWith(-3);
});

test("creates the session through the pinned Electron session with explicit cookie-jar credentials", async () => {
	desktopFetch.mockResolvedValue(
		new Response("{}", {
			headers: { "Set-Cookie": "zerobyte.session_token=test-token; HttpOnly; Secure; Path=/" },
		}),
	);
	const url = "https://127.0.0.1:12345";
	const result = await createDesktopSession(url, "test-launch-secret");

	expect(result).toBeUndefined();
	expect(desktopFetch).toHaveBeenCalledExactlyOnceWith(
		`${url}/api/v1/desktop/session`,
		expect.objectContaining({
			method: "POST",
			credentials: "include",
			redirect: "error",
			headers: expect.objectContaining({ [launchSecretHeader]: "test-launch-secret" }),
		}),
	);
});

test("rejects plaintext bootstrap URLs before sending the launch secret", async () => {
	await expect(createDesktopSession("http://127.0.0.1:12345", "test-launch-secret")).rejects.toThrow("HTTPS");
	expect(desktopFetch).not.toHaveBeenCalled();
});

test("fails bootstrap without installing cookies when the pinned connection fails", async () => {
	desktopFetch.mockRejectedValue(new Error("Certificate rejected"));
	await expect(createDesktopSession("https://127.0.0.1:12345", "test-launch-secret")).rejects.toThrow(
		"Certificate rejected",
	);
});
