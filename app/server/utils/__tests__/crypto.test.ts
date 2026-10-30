import { describe, expect, test, vi } from "vitest";

describe("cryptoUtils", () => {
	test("sealSecret treats encrypted-looking values as plaintext", async () => {
		const { cryptoUtils } = await vi.importActual<typeof import("../crypto")>("../crypto");
		const plaintext = "encv1:literal-import-value";

		const encryptedValue = await cryptoUtils.sealSecret(plaintext);

		expect(encryptedValue).not.toBe(plaintext);
		await expect(cryptoUtils.resolveSecret(encryptedValue)).resolves.toBe(plaintext);
	});

	test("sealSecret has no input-provenance behavior", async () => {
		const { cryptoUtils } = await vi.importActual<typeof import("../crypto")>("../crypto");

		const encryptedValue = await cryptoUtils.sealSecret("plain secret");
		const resealedValue = await cryptoUtils.sealSecret(encryptedValue);

		await expect(cryptoUtils.resolveSecret(resealedValue)).resolves.toBe(encryptedValue);
	});

	test("timingSafeEqualString compares string secrets", async () => {
		const { cryptoUtils } = await vi.importActual<typeof import("../crypto")>("../crypto");

		expect(cryptoUtils.timingSafeEqualString("secret", "secret")).toBe(true);
		expect(cryptoUtils.timingSafeEqualString("secret", "secRet")).toBe(false);
		expect(cryptoUtils.timingSafeEqualString("secret", "short")).toBe(false);
	});
});
