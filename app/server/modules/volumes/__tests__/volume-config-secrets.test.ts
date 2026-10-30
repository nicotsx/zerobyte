import { afterEach, expect, test, vi } from "vitest";
import { volumeConfigSchema, type BackendConfig } from "@zerobyte/contracts/volumes";
import { cryptoUtils } from "~/server/utils/crypto";
import { STORED_SECRET } from "~/server/utils/stored-secret";
import { encryptVolumeConfig, prepareVolumeConfigUpdate, redactVolumeConfig } from "../volume-config-secrets";

const storedConfig = {
	backend: "sftp" as const,
	host: "backup.example.com",
	port: 22,
	username: "backup",
	password: "encv1:stored-password",
	privateKey: "encv1:stored-private-key",
	path: "/backups",
	skipHostKeyCheck: false,
	knownHosts: "backup.example.com ssh-ed25519 AAAA",
	allowLegacySshRsa: false,
	allowUnsafeSymlinkTargets: false,
};

afterEach(() => {
	vi.restoreAllMocks();
});

test.each([
	{ backend: "smb", server: "nas", share: "backups", password: "password" },
	{ backend: "webdav", server: "nas", path: "/backups", password: "password" },
])("preserves stored $backend credentials when requests apply default ports", async (legacy) => {
	const actual = await vi.importActual<typeof import("~/server/utils/crypto")>("~/server/utils/crypto");
	vi.spyOn(cryptoUtils, "sealSecret").mockImplementation(actual.cryptoUtils.sealSecret);
	vi.spyOn(cryptoUtils, "resolveSecret").mockImplementation(actual.cryptoUtils.resolveSecret);
	const stored = await encryptVolumeConfig(volumeConfigSchema.parse(legacy));
	Reflect.deleteProperty(stored, "port");
	if (stored.backend === "smb") {
		Reflect.deleteProperty(stored, "vers");
		Reflect.deleteProperty(stored, "mapToContainerUidGid");
	}
	const submitted = volumeConfigSchema.parse(redactVolumeConfig(stored));
	if (submitted.backend !== "smb" && submitted.backend !== "webdav") throw new Error("Unexpected fixture backend");

	await expect(prepareVolumeConfigUpdate(stored, submitted)).resolves.toEqual({
		config: volumeConfigSchema.parse(stored),
		changed: false,
	});
	await expect(prepareVolumeConfigUpdate(stored, { ...submitted, port: 1234 })).rejects.toThrow("re-entered");
});

test("redacts and preserves volume credentials for the same authority", async () => {
	const presented = (await redactVolumeConfig(storedConfig)) as Extract<BackendConfig, { backend: "sftp" }>;

	expect(presented).toMatchObject({ password: STORED_SECRET, privateKey: STORED_SECRET });
	await expect(prepareVolumeConfigUpdate(storedConfig, presented)).resolves.toEqual({
		config: storedConfig,
		changed: false,
	});
});

test("requires new credentials for a changed volume authority", async () => {
	const presented = (await redactVolumeConfig(storedConfig)) as Extract<BackendConfig, { backend: "sftp" }>;

	await expect(prepareVolumeConfigUpdate(storedConfig, { ...presented, host: "other.example.com" })).rejects.toThrow(
		"re-entered",
	);
});

test("rejects ciphertext on volume creation", async () => {
	await expect(encryptVolumeConfig(storedConfig)).rejects.toThrow("plaintext");
});

test("preserves ciphertext when identical volume credentials are re-entered", async () => {
	const actual = await vi.importActual<typeof import("~/server/utils/crypto")>("~/server/utils/crypto");
	vi.spyOn(cryptoUtils, "sealSecret").mockImplementation(actual.cryptoUtils.sealSecret);
	vi.spyOn(cryptoUtils, "resolveSecret").mockImplementation(actual.cryptoUtils.resolveSecret);

	const encryptedPassword = await actual.cryptoUtils.sealSecret("password");
	const encryptedPrivateKey = await actual.cryptoUtils.sealSecret("private-key");
	const encryptedConfig = { ...storedConfig, password: encryptedPassword, privateKey: encryptedPrivateKey };
	const submittedConfig = { ...storedConfig, password: "password", privateKey: "private-key" };

	await expect(prepareVolumeConfigUpdate(encryptedConfig, submittedConfig)).resolves.toEqual({
		config: encryptedConfig,
		changed: false,
	});
});

test("round-trips stored legacy volume credentials without changing them", async () => {
	const stored = { ...storedConfig, password: "legacy-password", privateKey: "file://legacy-private-key" };
	const presented = redactVolumeConfig(stored);

	expect(presented).toMatchObject({ password: STORED_SECRET, privateKey: STORED_SECRET });
	await expect(prepareVolumeConfigUpdate(stored, presented)).resolves.toEqual({
		config: stored,
		changed: false,
	});
});
