import { afterEach, expect, test, vi } from "vitest";
import { cryptoUtils } from "~/server/utils/crypto";
import { STORED_SECRET } from "~/server/utils/stored-secret";
import { prepareRepositoryConfigUpdate, redactRepositoryConfig } from "../repository-config-secrets";

afterEach(() => {
	vi.restoreAllMocks();
});

test("preserves ciphertext when identical repository credentials are re-entered", async () => {
	const actual = await vi.importActual<typeof import("~/server/utils/crypto")>("~/server/utils/crypto");
	vi.spyOn(cryptoUtils, "sealSecret").mockImplementation(actual.cryptoUtils.sealSecret);
	vi.spyOn(cryptoUtils, "resolveSecret").mockImplementation(actual.cryptoUtils.resolveSecret);

	const accessKeyId = await actual.cryptoUtils.sealSecret("access-key");
	const secretAccessKey = await actual.cryptoUtils.sealSecret("secret-key");
	const stored = {
		backend: "s3" as const,
		endpoint: "https://s3.example.com",
		bucket: "backups",
		accessKeyId,
		secretAccessKey,
	};
	const submitted = { ...stored, accessKeyId: "access-key", secretAccessKey: "secret-key" };

	await expect(prepareRepositoryConfigUpdate(stored, submitted)).resolves.toEqual({
		config: stored,
		changed: false,
	});
});

test("round-trips stored legacy repository credentials without changing them", async () => {
	const stored = {
		backend: "s3" as const,
		endpoint: "https://s3.example.com",
		bucket: "backups",
		accessKeyId: "legacy-access-key",
		secretAccessKey: "env://LEGACY_SECRET_KEY",
	};
	const presented = redactRepositoryConfig(stored);

	expect(presented).toMatchObject({ accessKeyId: STORED_SECRET, secretAccessKey: STORED_SECRET });
	await expect(prepareRepositoryConfigUpdate(stored, presented)).resolves.toEqual({
		config: stored,
		changed: false,
	});
});
