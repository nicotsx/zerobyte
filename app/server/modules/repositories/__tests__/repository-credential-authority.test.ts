import { beforeAll, beforeEach, afterEach, expect, test, vi } from "vitest";
import type { RepositoryConfig } from "@zerobyte/core/restic";
import { withContext } from "~/server/core/request-context";
import { db } from "~/server/db/db";
import { cryptoUtils } from "~/server/utils/crypto";
import { STORED_SECRET } from "~/server/utils/stored-secret";
import { createTestSession } from "~/test/helpers/auth";
import { createTestRepository } from "~/test/helpers/repository";
import { repositoriesService } from "../repositories.service";
import {
	decryptRepositoryConfig,
	encryptRepositoryConfig,
	prepareRepositoryConfigUpdate,
	redactRepositoryConfig,
} from "../repository-config-secrets";

const tlsConfigs: RepositoryConfig[] = [
	{ backend: "rest", url: "https://backup.example", username: "backup", password: "saved-password" },
	{
		backend: "s3",
		endpoint: "https://s3.example",
		bucket: "backups",
		accessKeyId: "saved-access-key",
		secretAccessKey: "saved-secret-key",
	},
	{
		backend: "r2",
		endpoint: "https://r2.example",
		bucket: "backups",
		accessKeyId: "saved-access-key",
		secretAccessKey: "saved-secret-key",
	},
	{ backend: "gcs", bucket: "backups", projectId: "backup", credentialsJson: "saved-credentials" },
	{ backend: "azure", accountName: "backup", container: "backups", accountKey: "saved-account-key" },
	{ backend: "rclone", remote: "backup", path: "/backups", customPassword: "saved-password" },
];

const sftpConfig: RepositoryConfig = {
	backend: "sftp",
	host: "backup.example",
	port: 22,
	user: "backup",
	path: "/backups",
	privateKey: "saved-private-key",
	skipHostKeyCheck: false,
	knownHosts: "backup.example ssh-ed25519 TRUSTED",
	allowLegacySshRsa: false,
};

let session: Awaited<ReturnType<typeof createTestSession>>;

beforeAll(async () => {
	session = await createTestSession();
});

beforeEach(async () => {
	const actual = await vi.importActual<typeof import("~/server/utils/crypto")>("~/server/utils/crypto");
	vi.spyOn(cryptoUtils, "sealSecret").mockImplementation(actual.cryptoUtils.sealSecret);
	vi.spyOn(cryptoUtils, "resolveSecret").mockImplementation(actual.cryptoUtils.resolveSecret);
});

afterEach(() => vi.restoreAllMocks());

const tlsChanges = [{ insecureTls: true }, { cacert: "replacement-ca" }, { cacert: "" }, { cacert: undefined }];

test.each(tlsConfigs.flatMap((config) => tlsChanges.map((change) => ({ config, change }))))(
	"rejects $config.backend verification changes without modifying the repository: $change",
	async ({ config, change }) => {
		const stored = await encryptRepositoryConfig({ ...config, cacert: "trusted-ca" });
		const repository = await createTestRepository({
			organizationId: session.organizationId,
			type: stored.backend,
			config: stored,
			status: "healthy",
			lastChecked: 123,
		});

		await expect(
			withContext({ organizationId: session.organizationId }, () =>
				repositoriesService.updateRepository(repository.shortId, {
					config: { ...redactRepositoryConfig(stored), ...change },
				}),
			),
		).rejects.toThrow("re-entered");

		expect(await db.query.repositoriesTable.findFirst({ where: { id: repository.id } })).toEqual(repository);
	},
);

test.each(tlsConfigs)("rejects adding a CA while preserving $backend credentials", async (config) => {
	const stored = await encryptRepositoryConfig(config);

	await expect(
		prepareRepositoryConfigUpdate(stored, { ...redactRepositoryConfig(stored), cacert: "replacement-ca" }),
	).rejects.toThrow("re-entered");
});

const sftpChanges = [
	{ skipHostKeyCheck: true },
	{ knownHosts: "backup.example ssh-ed25519 REPLACEMENT" },
	{ knownHosts: "" },
	{ knownHosts: undefined },
	{ allowLegacySshRsa: true },
];

test.each(sftpChanges)("rejects SFTP verification changes without modifying the repository: %j", async (change) => {
	const stored = await encryptRepositoryConfig(sftpConfig);
	const repository = await createTestRepository({
		organizationId: session.organizationId,
		type: "sftp",
		config: stored,
	});

	await expect(
		withContext({ organizationId: session.organizationId }, () =>
			repositoriesService.updateRepository(repository.shortId, {
				config: { ...redactRepositoryConfig(stored), ...change },
			}),
		),
	).rejects.toThrow("re-entered");

	expect(await db.query.repositoriesTable.findFirst({ where: { id: repository.id } })).toEqual(repository);
});

test.each(tlsConfigs)("requires replacement $backend credentials when re-enabling TLS verification", async (config) => {
	const stored = await encryptRepositoryConfig({ ...config, insecureTls: true });

	await expect(
		prepareRepositoryConfigUpdate(stored, { ...redactRepositoryConfig(stored), insecureTls: false }),
	).rejects.toThrow("re-entered");
});

test.each(sftpChanges)("allows SFTP verification changes with a replacement key: %j", async (change) => {
	const stored = await encryptRepositoryConfig(sftpConfig);
	const submitted = { ...sftpConfig, ...change, privateKey: "replacement-key" };
	const prepared = await prepareRepositoryConfigUpdate(stored, submitted);

	expect(prepared.changed).toBe(true);
	await expect(decryptRepositoryConfig(prepared.config)).resolves.toEqual(submitted);
});

test("requires a replacement key when adding SFTP host verification", async () => {
	const stored = await encryptRepositoryConfig({ ...sftpConfig, knownHosts: undefined });

	await expect(prepareRepositoryConfigUpdate(stored, { ...sftpConfig, privateKey: STORED_SECRET })).rejects.toThrow(
		"re-entered",
	);
});

test.each(tlsConfigs)("preserves unchanged $backend credentials and an identical CA", async (config) => {
	const stored = await encryptRepositoryConfig({ ...config, cacert: "trusted-ca" });
	const presented = redactRepositoryConfig(stored);

	expect(presented.cacert).toBe(STORED_SECRET);
	await expect(prepareRepositoryConfigUpdate(stored, presented)).resolves.toEqual({ config: stored, changed: false });
	await expect(
		prepareRepositoryConfigUpdate(stored, { ...presented, cacert: "trusted-ca", insecureTls: false }),
	).resolves.toEqual({ config: { ...stored, insecureTls: false }, changed: true });
});

test.each([...tlsConfigs, sftpConfig])(
	"permits $backend verification changes with replacement credentials",
	async (config) => {
		const stored = await encryptRepositoryConfig({ ...config, cacert: "trusted-ca" });
		const submitted = { ...config, cacert: "replacement-ca", insecureTls: true };
		const prepared = await prepareRepositoryConfigUpdate(stored, submitted);

		expect(prepared.changed).toBe(true);
		await expect(decryptRepositoryConfig(prepared.config)).resolves.toEqual(submitted);
	},
);

test("preserves SFTP credentials when host verification is unchanged", async () => {
	const stored = await encryptRepositoryConfig(sftpConfig);

	await expect(prepareRepositoryConfigUpdate(stored, redactRepositoryConfig(stored))).resolves.toEqual({
		config: stored,
		changed: false,
	});
});
