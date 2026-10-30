import { afterEach, expect, test, vi } from "vitest";
import { Effect } from "effect";
import { createTestSession } from "~/test/helpers/auth";
import { createTestVolume } from "~/test/helpers/volume";
import { withContext } from "~/server/core/request-context";
import { cryptoUtils } from "~/server/utils/crypto";
import { STORED_SECRET } from "~/lib/stored-secret";
import { db } from "~/server/db/db";
import { volumeService } from "../volume.service";
import * as operations from "../volume-host/operations";
import { createApp } from "~/server/app";
import { volumeConfigSchema } from "@zerobyte/contracts/volumes";
import { encryptVolumeConfig, redactVolumeConfig } from "../volume-config-secrets";
import * as lifecycle from "../volume-lifecycle";

afterEach(() => vi.restoreAllMocks());

test.each([
	{ missing: ["allowLegacySshRsa"] },
	{ missing: ["skipHostKeyCheck"] },
	{ missing: ["skipHostKeyCheck", "allowLegacySshRsa", "allowUnsafeSymlinkTargets"] },
])("saves and tests legacy SFTP credentials with absent defaults: $missing", async ({ missing }) => {
	const actual = await vi.importActual<typeof import("~/server/utils/crypto")>("~/server/utils/crypto");
	vi.spyOn(cryptoUtils, "sealSecret").mockImplementation(actual.cryptoUtils.sealSecret);
	vi.spyOn(cryptoUtils, "resolveSecret").mockImplementation(actual.cryptoUtils.resolveSecret);
	const session = await createTestSession();
	const config = volumeConfigSchema.parse({
		backend: "sftp",
		host: "nas",
		port: 22,
		username: "backup",
		path: "/backups",
		password: "saved-password",
		privateKey: "saved-private-key",
		knownHosts: "nas ssh-ed25519 TRUSTED",
	});
	const stored = await encryptVolumeConfig(config);
	for (const field of missing) Reflect.deleteProperty(stored, field);

	const volume = await createTestVolume({ organizationId: session.organizationId, type: "sftp", config: stored });
	const submitted = volumeConfigSchema.parse(redactVolumeConfig(stored));
	const testConnection = vi
		.spyOn(operations, "testVolumeConnection")
		.mockReturnValue(Effect.succeed({ success: true, message: "Connected" }));
	const backendOperation = vi
		.spyOn(lifecycle, "runVolumeBackendOperation")
		.mockRejectedValue(new Error("Unchanged credentials must not remount"));
	const app = createApp();
	const headers = { ...session.headers, "Content-Type": "application/json" };
	const original = await db.query.volumesTable.findFirst({ where: { id: volume.id } });

	for (const change of [{ skipHostKeyCheck: true }, { allowLegacySshRsa: true }]) {
		const changed = { ...submitted, ...change };
		const rejectedTest = await app.request("/api/v1/volumes/test-connection", {
			method: "POST",
			headers,
			body: JSON.stringify({ shortId: volume.shortId, config: changed }),
		});
		const rejectedSave = await app.request(`/api/v1/volumes/${volume.shortId}`, {
			method: "PUT",
			headers,
			body: JSON.stringify({ config: changed }),
		});

		expect(rejectedTest.status).toBe(400);
		expect(rejectedSave.status).toBe(400);
	}

	expect(testConnection).not.toHaveBeenCalled();
	expect(backendOperation).not.toHaveBeenCalled();
	expect(await db.query.volumesTable.findFirst({ where: { id: volume.id } })).toEqual(original);

	const tested = await app.request("/api/v1/volumes/test-connection", {
		method: "POST",
		headers,
		body: JSON.stringify({ shortId: volume.shortId, config: submitted }),
	});

	expect(tested.status).toBe(200);
	expect(testConnection).toHaveBeenCalledExactlyOnceWith(config);
	expect(await db.query.volumesTable.findFirst({ where: { id: volume.id } })).toEqual(original);

	const saved = await app.request(`/api/v1/volumes/${volume.shortId}`, {
		method: "PUT",
		headers,
		body: JSON.stringify({ config: submitted }),
	});

	expect(saved.status).toBe(200);
	expect(backendOperation).not.toHaveBeenCalled();
	expect((await db.query.volumesTable.findFirst({ where: { id: volume.id } }))?.config).toEqual({
		...stored,
		skipHostKeyCheck: false,
		allowLegacySshRsa: false,
		allowUnsafeSymlinkTargets: false,
	});
});

test("the connection-test route rejects redirection before starting backend work", async () => {
	const session = await createTestSession();
	const config = {
		backend: "webdav" as const,
		server: "nas",
		port: 443,
		ssl: true,
		path: "/backup",
		password: "saved-password",
	};
	const volume = await createTestVolume({ organizationId: session.organizationId, type: "webdav", config });
	const testConnection = vi
		.spyOn(operations, "testVolumeConnection")
		.mockReturnValue(Effect.succeed({ success: true, message: "Connected" }));
	const app = createApp();

	const rejected = await app.request("/api/v1/volumes/test-connection", {
		method: "POST",
		headers: { ...session.headers, "Content-Type": "application/json" },
		body: JSON.stringify({
			shortId: volume.shortId,
			config: { ...config, server: "attacker.example", password: STORED_SECRET },
		}),
	});
	expect(rejected.status).toBe(400);
	expect(testConnection).not.toHaveBeenCalled();

	const accepted = await app.request("/api/v1/volumes/test-connection", {
		method: "POST",
		headers: { ...session.headers, "Content-Type": "application/json" },
		body: JSON.stringify({ shortId: volume.shortId, config: { ...config, password: STORED_SECRET } }),
	});
	expect(accepted.status).toBe(200);
	expect(testConnection).toHaveBeenCalledExactlyOnceWith(config);
});

test.each([
	{ host: "attacker.example" },
	{ port: 2222 },
	{ username: "other-user" },
	{ path: "/other" },
	{ skipHostKeyCheck: true },
	{ knownHosts: "nas ssh-ed25519 ATTACKER" },
	{ allowLegacySshRsa: true },
])("does not reuse SFTP credentials when authority changes: %j", async (change) => {
	const { organizationId } = await createTestSession();
	const config = {
		backend: "sftp" as const,
		host: "nas",
		port: 22,
		username: "backup",
		path: "/backups",
		password: "stored-password",
		privateKey: "stored-private-key",
		skipHostKeyCheck: false,
		knownHosts: "nas ssh-ed25519 TRUSTED",
		allowLegacySshRsa: false,
		allowUnsafeSymlinkTargets: false,
	};
	const volume = await createTestVolume({ organizationId, type: "sftp", config });
	const testConnection = vi.spyOn(operations, "testVolumeConnection");
	const submitted = { ...config, ...change, password: STORED_SECRET, privateKey: STORED_SECRET };

	await expect(
		withContext({ organizationId }, () => volumeService.testConnection(submitted, volume.shortId)),
	).rejects.toThrow("re-entered");
	expect(testConnection).not.toHaveBeenCalled();
});

test.each([true, false])("tests saved credentials without changing storage (encrypted: %s)", async (encrypted) => {
	const actual = await vi.importActual<typeof import("~/server/utils/crypto")>("~/server/utils/crypto");
	vi.spyOn(cryptoUtils, "sealSecret").mockImplementation(actual.cryptoUtils.sealSecret);
	vi.spyOn(cryptoUtils, "resolveSecret").mockImplementation(actual.cryptoUtils.resolveSecret);
	const { organizationId } = await createTestSession();
	const config = {
		backend: "smb" as const,
		server: "nas",
		share: "backups",
		username: "backup",
		password: "saved-password",
		port: 445,
		vers: "3.0" as const,
		mapToContainerUidGid: false,
	};
	const storedConfig = {
		...config,
		password: encrypted ? await actual.cryptoUtils.sealSecret(config.password) : config.password,
	};
	const volume = await createTestVolume({ organizationId, type: "smb", config: storedConfig });
	const testConnection = vi
		.spyOn(operations, "testVolumeConnection")
		.mockReturnValue(Effect.succeed({ success: true, message: "Connected" }));

	await withContext({ organizationId }, () =>
		volumeService.testConnection({ ...config, password: STORED_SECRET }, volume.shortId),
	);

	expect(testConnection).toHaveBeenCalledExactlyOnceWith(config);
	expect((await db.query.volumesTable.findFirst({ where: { id: volume.id } }))?.config).toEqual(storedConfig);
});

test("does not test stored credentials against a changed destination or another organization", async () => {
	const owner = await createTestSession();
	const other = await createTestSession();
	const config = {
		backend: "webdav" as const,
		server: "nas",
		path: "/backups",
		username: "backup",
		password: "saved-password",
		port: 443,
		ssl: true,
	};
	const volume = await createTestVolume({ organizationId: owner.organizationId, type: "webdav", config });
	const testConnection = vi.spyOn(operations, "testVolumeConnection");
	const submitted = { ...config, password: STORED_SECRET };

	await expect(
		withContext({ organizationId: owner.organizationId }, () =>
			volumeService.testConnection({ ...submitted, server: "other-host" }, volume.shortId),
		),
	).rejects.toThrow("re-entered");
	await expect(
		withContext({ organizationId: other.organizationId }, () =>
			volumeService.testConnection(submitted, volume.shortId),
		),
	).rejects.toThrow("Volume not found");
	await expect(volumeService.testConnection(submitted)).rejects.toThrow("plaintext");
	expect(testConnection).not.toHaveBeenCalled();
});
