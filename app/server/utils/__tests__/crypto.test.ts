import { describe, expect, test, vi } from "vitest";

describe("cryptoUtils", () => {
	test("sealSecret rejects encrypted values that cannot be decrypted with the current app secret", async () => {
		const { cryptoUtils } = await vi.importActual<typeof import("../crypto")>("../crypto");
		const invalidEncryptedValue = "encv1:00:00:00:00";

		await expect(cryptoUtils.sealSecret(invalidEncryptedValue)).rejects.toThrow(
			"You have provided an encrypted value that cannot be decrypted with the current APP_SECRET",
		);
	});

	test("sealSecret preserves encrypted values that can be decrypted with the current app secret", async () => {
		const { cryptoUtils } = await vi.importActual<typeof import("../crypto")>("../crypto");

		const encryptedValue = await cryptoUtils.sealSecret("plain secret");

		await expect(cryptoUtils.sealSecret(encryptedValue)).resolves.toBe(encryptedValue);
	});

	test("timingSafeEqualString compares string secrets", async () => {
		const { cryptoUtils } = await vi.importActual<typeof import("../crypto")>("../crypto");

		expect(cryptoUtils.timingSafeEqualString("secret", "secret")).toBe(true);
		expect(cryptoUtils.timingSafeEqualString("secret", "secRet")).toBe(false);
		expect(cryptoUtils.timingSafeEqualString("secret", "short")).toBe(false);
	});
});
