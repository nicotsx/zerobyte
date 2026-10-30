import { afterEach, expect, test, vi } from "vitest";
import { cryptoUtils } from "../crypto";
import { preserveOrSealSecret, sealNewSecret, STORED_SECRET } from "../stored-secret";

afterEach(() => vi.restoreAllMocks());

test("allows replacing an unreadable stored credential without weakening new-input validation", async () => {
	const actual = await vi.importActual<typeof import("../crypto")>("../crypto");
	vi.spyOn(cryptoUtils, "sealSecret").mockImplementation(actual.cryptoUtils.sealSecret);
	vi.spyOn(cryptoUtils, "resolveSecret").mockImplementation(actual.cryptoUtils.resolveSecret);

	const ciphertext = await actual.cryptoUtils.sealSecret("previous-password");
	const damaged = ciphertext.slice(0, -1) + (ciphertext.endsWith("0") ? "1" : "0");
	for (const unreadable of ["encv1:corrupted", damaged]) {
		const replacement = await preserveOrSealSecret("replacement-password", unreadable, true);
		expect(cryptoUtils.isEncrypted(replacement)).toBe(true);
		await expect(actual.cryptoUtils.resolveSecret(replacement)).resolves.toBe("replacement-password");
	}

	await expect(preserveOrSealSecret("encv1:submitted", "encv1:corrupted", true)).rejects.toThrow("plaintext");

	const stored = await actual.cryptoUtils.sealSecret("same-password");
	await expect(preserveOrSealSecret("same-password", stored, true)).resolves.toBe(stored);
});

test("rejects ciphertext and the stored marker as new credentials", async () => {
	const ciphertext = "encv1:stored-secret";

	await expect(sealNewSecret(ciphertext)).rejects.toThrow("plaintext");
	await expect(sealNewSecret(STORED_SECRET)).rejects.toThrow("plaintext");
});

test("preserves only the supplied field's existing stored value", async () => {
	const ciphertext = "encv1:stored-secret";

	await expect(preserveOrSealSecret(STORED_SECRET, ciphertext, true)).resolves.toBe(ciphertext);
	await expect(preserveOrSealSecret(STORED_SECRET, "legacy-plaintext", true)).resolves.toBe("legacy-plaintext");
	await expect(preserveOrSealSecret(STORED_SECRET, "env://LEGACY_SECRET", true)).resolves.toBe("env://LEGACY_SECRET");
	await expect(preserveOrSealSecret(STORED_SECRET, undefined, true)).rejects.toThrow("unavailable");
	await expect(preserveOrSealSecret(STORED_SECRET, ciphertext, false)).rejects.toThrow("re-entered");
});
