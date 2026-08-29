import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { eq } from "drizzle-orm";
import { config } from "~/server/core/config";
import { db } from "~/server/db/db";
import { organization, repositoriesTable, sessionsTable, usersTable } from "~/server/db/schema";
import { cryptoUtils } from "~/server/utils/crypto";
import { generateShortId } from "~/server/utils/id";
import { createTestSession } from "~/test/helpers/auth";
import { decryptConfigTransferPayload } from "../envelope";
import {
	allowConfigExportPassword,
	fixturePassphrase,
	encryptPayload,
	loadPayload,
	loadEncryptedConfig,
	requestConfigExport,
	requestConfigImport,
} from "./config-transfer-test-helpers";
import { loadConfigState } from "./config-transfer-state-test-helpers";
import { seedConfig } from "./config-transfer-fixture-test-helpers";

beforeEach(() => {
	config.webhookAllowedOrigins = ["https://example.com", "https://hooks.slack.example.test"];
	vi.spyOn(cryptoUtils, "sealSecret").mockImplementation(async (value) => `encv1:test:${value}`);
	vi.spyOn(cryptoUtils, "resolveSecret").mockImplementation(async (value) =>
		value.startsWith("encv1:test:") ? value.slice("encv1:test:".length) : value,
	);
});

afterEach(() => {
	config.webhookAllowedOrigins = [];
	config.runtime = "server";
	vi.restoreAllMocks();
});

describe("configuration import", () => {
	test("imports the frozen v1 fixture", async () => {
		config.runtime = "desktop";
		const encryptedConfig = await loadEncryptedConfig();
		const fixture = await loadPayload();
		const decryptedPayload = JSON.parse(await decryptConfigTransferPayload(encryptedConfig, fixturePassphrase));
		const targetSession = await createTestSession();
		await db
			.update(sessionsTable)
			.set({ authSource: "desktop-session" })
			.where(eq(sessionsTable.token, targetSession.session.token));

		expect(decryptedPayload).toEqual(fixture);
		const response = await requestConfigImport(targetSession.headers, encryptedConfig);

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({
			imported: {
				repositories: fixture.repositories.length,
				volumes: fixture.volumes.length,
				backupSchedules: fixture.backupSchedules.length,
				notificationDestinations: fixture.notificationDestinations.length,
				backupScheduleMirrors: fixture.backupScheduleMirrors.length,
				backupScheduleNotifications: fixture.backupScheduleNotifications.length,
			},
			warnings: [
				'Volume "Fixture Volume" uses the "rclone" backend, which is unavailable on this server. Enable that backend and mount the volume before using it.',
				'Repository "Fixture Primary Repository" uses the "rclone" backend, which is unavailable on this server. Enable that backend before using it.',
				'Repository "Fixture Mirror Repository" uses the "rclone" backend, which is unavailable on this server. Enable that backend before using it.',
				'Disabled schedule "Fixture Nightly Backup" because it references volume "Fixture Volume", repository "Fixture Primary Repository", and repository "Fixture Mirror Repository". Re-enable it after reviewing those imported resources on this server.',
			],
		});

		const imported = await loadConfigState(targetSession.organizationId);
		expect(imported.repositories).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					name: "Fixture Primary Repository",
					compressionMode: "max",
					config: expect.objectContaining({ customPassword: "fixture-primary-password" }),
				}),
			]),
		);
		expect(imported.backupSchedules).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					name: "Fixture Nightly Backup",
					volumeName: "Fixture Volume",
					repositoryName: "Fixture Primary Repository",
					enabled: false,
				}),
			]),
		);
		expect(imported.backupScheduleMirrors).toEqual([
			{
				scheduleName: "Fixture Nightly Backup",
				repositoryName: "Fixture Mirror Repository",
				enabled: false,
			},
		]);

		const storedRepositories = await db.query.repositoriesTable.findMany({
			where: { organizationId: targetSession.organizationId },
		});
		const storedPrimaryRepository = storedRepositories.find(
			(repository) => repository.name === "Fixture Primary Repository",
		);
		const storedOrganization = await db.query.organization.findFirst({
			where: { id: targetSession.organizationId },
		});
		expect(storedPrimaryRepository?.config.customPassword).toMatch(/^encv1:/);
		expect(storedPrimaryRepository?.autoCheckEnabled).toBe(true);
		expect(storedOrganization?.metadata?.resticPassword).toMatch(/^encv1:/);
		expect(storedOrganization?.recoveryMaterialExportedAt).toBeInstanceOf(Date);

		const storedSchedule = await db.query.backupSchedulesTable.findFirst({
			where: { organizationId: targetSession.organizationId },
		});
		expect(storedSchedule).toMatchObject({
			shortId: fixture.backupSchedules[0].shortId,
			lastBackupAt: null,
			lastBackupStatus: null,
			lastBackupError: null,
			failureRetryCount: 0,
		});
		expect(storedSchedule?.nextBackupAt).toBeGreaterThan(Date.now());
	});

	test("preserves config and snapshot tags while disabling schedules for review", async () => {
		const sourceSession = await createTestSession();
		const { schedule: sourceSchedule } = await seedConfig(sourceSession.organizationId);
		const sourceConfig = await loadConfigState(sourceSession.organizationId);
		const expectedConfig = {
			...sourceConfig,
			backupSchedules: sourceConfig.backupSchedules.map((schedule) => ({ ...schedule, enabled: false })),
		};
		allowConfigExportPassword();

		const exportResponse = await requestConfigExport(sourceSession.headers);
		expect(exportResponse.status).toBe(200);
		const encryptedConfig = await exportResponse.text();
		const exportedPayload = await decryptConfigTransferPayload(encryptedConfig, fixturePassphrase);
		expect(exportedPayload).not.toContain("encv1:");
		expect(exportedPayload).toContain("parity-secret-key");
		expect(encryptedConfig).not.toContain("parity-secret-key");
		expect(encryptedConfig).not.toContain(config.appSecret);

		const targetSession = await createTestSession();
		const importResponse = await requestConfigImport(targetSession.headers, encryptedConfig);

		expect(importResponse.status).toBe(200);
		expect(await loadConfigState(targetSession.organizationId)).toEqual(expectedConfig);

		const storedRepositories = await db.query.repositoriesTable.findMany({
			where: { organizationId: targetSession.organizationId },
		});
		const storedRepository = storedRepositories.find(
			(repository) => repository.name === "Parity Primary Repository",
		);
		const storedVolume = await db.query.volumesTable.findFirst({
			where: { organizationId: targetSession.organizationId },
		});
		const storedSchedule = await db.query.backupSchedulesTable.findFirst({
			where: { organizationId: targetSession.organizationId },
		});
		const storedDestination = await db.query.notificationDestinationsTable.findFirst({
			where: { organizationId: targetSession.organizationId },
		});
		expect(storedRepository?.config.customPassword).toMatch(/^encv1:/);
		expect(storedRepository?.config.backend === "s3" && storedRepository.config.secretAccessKey).toMatch(/^encv1:/);
		expect(storedVolume?.config.backend === "sftp" && storedVolume.config.password).toMatch(/^encv1:/);
		expect(storedVolume?.config.backend === "sftp" && storedVolume.config.privateKey).toMatch(/^encv1:/);
		expect(storedSchedule?.shortId).toBe(sourceSchedule.shortId);
		expect(storedDestination?.config.type === "slack" && storedDestination.config.webhookUrl).toMatch(/^encv1:/);
	});

	test("preserves the same snapshot tag across organizations", async () => {
		const encryptedConfig = await loadEncryptedConfig();
		const fixture = await loadPayload();
		const [firstSession, secondSession] = await Promise.all([createTestSession(), createTestSession()]);

		const responses = await Promise.all([
			requestConfigImport(firstSession.headers, encryptedConfig),
			requestConfigImport(secondSession.headers, encryptedConfig),
		]);

		expect(responses.map((response) => response.status)).toEqual([200, 200]);
		const schedules = await Promise.all(
			[firstSession, secondSession].map((session) =>
				db.query.backupSchedulesTable.findFirst({ where: { organizationId: session.organizationId } }),
			),
		);
		expect(schedules.map((schedule) => schedule?.shortId)).toEqual([
			fixture.backupSchedules[0].shortId,
			fixture.backupSchedules[0].shortId,
		]);
	});

	test("warns about local paths and disables dependent schedules", async () => {
		const payload = await loadPayload();
		payload.volumes[0].config = { backend: "directory", path: "/tmp/source-volume" };
		payload.repositories[0].config = { backend: "local", path: "/tmp/source-repository" };
		payload.repositories[1].config = { backend: "local", path: "/tmp/mirror-repository" };
		const targetSession = await createTestSession();

		const response = await requestConfigImport(targetSession.headers, await encryptPayload(payload));

		expect(response.status).toBe(200);
		expect(await response.json()).toMatchObject({
			warnings: expect.arrayContaining([
				'Volume "Fixture Volume" uses local directory path "/tmp/source-volume". Verify and mount this path on this server before using it.',
				'Repository "Fixture Primary Repository" uses local path "/tmp/source-repository". Verify that this repository exists on this server before using it.',
				'Repository "Fixture Mirror Repository" uses local path "/tmp/mirror-repository". Verify that this repository exists on this server before using it.',
				'Disabled schedule "Fixture Nightly Backup" because it references volume "Fixture Volume", repository "Fixture Primary Repository", and repository "Fixture Mirror Repository". Re-enable it after reviewing those imported resources on this server.',
			]),
		});

		const schedule = await db.query.backupSchedulesTable.findFirst({
			where: { organizationId: targetSession.organizationId },
		});
		expect(schedule?.enabled).toBe(false);
	});

	test("rejects invalid schedule configuration before writing", async () => {
		const invalidCronPayload = await loadPayload();
		invalidCronPayload.backupSchedules[0].cronExpression = "not-a-cron";
		const invalidParamsPayload = await loadPayload();
		invalidParamsPayload.backupSchedules[0].customResticParams = ["--repo", "/tmp/repo"];

		for (const payload of [invalidCronPayload, invalidParamsPayload]) {
			const targetSession = await createTestSession();
			const response = await requestConfigImport(targetSession.headers, await encryptPayload(payload));

			expect(response.status).toBe(400);
			expect(
				await db.query.backupSchedulesTable.findFirst({
					where: { organizationId: targetSession.organizationId },
				}),
			).toBeUndefined();
		}
	});

	test("normalizes imported volume and notification destination names", async () => {
		const payload = await loadPayload();
		payload.volumes[0].name = "  Imported volume  ";
		payload.notificationDestinations[0].name = "  Imported destination  ";
		const targetSession = await createTestSession();
		const encryptedConfig = await encryptPayload(payload);

		const response = await requestConfigImport(targetSession.headers, encryptedConfig);

		expect(response.status).toBe(200);
		const [volume, destination] = await Promise.all([
			db.query.volumesTable.findFirst({ where: { organizationId: targetSession.organizationId } }),
			db.query.notificationDestinationsTable.findFirst({
				where: { organizationId: targetSession.organizationId },
			}),
		]);
		expect(volume?.name).toBe("Imported volume");
		expect(destination?.name).toBe("Imported destination");
	});

	test("rejects invalid imported names before writing", async () => {
		const whitespaceVolumePayload = await loadPayload();
		whitespaceVolumePayload.volumes[0].name = " \t ";
		const whitespaceRepositoryPayload = await loadPayload();
		whitespaceRepositoryPayload.repositories[0].name = " \t ";
		const whitespaceDestinationPayload = await loadPayload();
		whitespaceDestinationPayload.notificationDestinations[0].name = " \n ";
		const oversizedSchedulePayload = await loadPayload();
		oversizedSchedulePayload.backupSchedules[0].name = "a".repeat(129);
		const duplicateScheduleNamePayload = await loadPayload();
		const duplicateSchedule = {
			...duplicateScheduleNamePayload.backupSchedules[0],
			ref: "schedule:duplicate-name",
		};
		duplicateScheduleNamePayload.backupSchedules.push(duplicateSchedule);
		const duplicateVolumeNamePayload = await loadPayload();
		const existingVolume = duplicateVolumeNamePayload.volumes[0];
		if (!existingVolume) {
			throw new Error("Configuration fixture must include a volume");
		}
		duplicateVolumeNamePayload.volumes.push({
			...existingVolume,
			ref: "volume:duplicate-name",
			name: ` ${existingVolume.name} `,
		});
		const invalidPayloads = [
			whitespaceVolumePayload,
			whitespaceRepositoryPayload,
			whitespaceDestinationPayload,
			oversizedSchedulePayload,
			duplicateScheduleNamePayload,
			duplicateVolumeNamePayload,
		];

		for (const payload of invalidPayloads) {
			const targetSession = await createTestSession();
			const encryptedConfig = await encryptPayload(payload);
			const sealSecret = vi.mocked(cryptoUtils.sealSecret);
			sealSecret.mockClear();

			const response = await requestConfigImport(targetSession.headers, encryptedConfig);

			expect(response.status).toBe(400);
			expect(await loadConfigState(targetSession.organizationId)).toEqual({
				repositories: [],
				volumes: [],
				backupSchedules: [],
				notificationDestinations: [],
				backupScheduleMirrors: [],
				backupScheduleNotifications: [],
			});
			expect(sealSecret).not.toHaveBeenCalled();
		}
	}, 10_000);

	test("rejects invalid mirror configuration before writing", async () => {
		const primaryAsMirrorPayload = await loadPayload();
		primaryAsMirrorPayload.backupScheduleMirrors[0].repositoryRef =
			primaryAsMirrorPayload.backupSchedules[0].repositoryRef;

		const incompatibleCredentialsPayload = await loadPayload();
		incompatibleCredentialsPayload.repositories[0].config = {
			backend: "s3",
			endpoint: "https://s3.example.test",
			bucket: "primary",
			accessKeyId: "primary-access-key",
			secretAccessKey: "primary-secret-key",
		};
		incompatibleCredentialsPayload.repositories[1].config = {
			backend: "s3",
			endpoint: "https://s3.example.test",
			bucket: "mirror",
			accessKeyId: "mirror-access-key",
			secretAccessKey: "mirror-secret-key",
		};

		for (const payload of [primaryAsMirrorPayload, incompatibleCredentialsPayload]) {
			const targetSession = await createTestSession();
			const sealSecret = vi.mocked(cryptoUtils.sealSecret);
			sealSecret.mockClear();
			const response = await requestConfigImport(targetSession.headers, await encryptPayload(payload));

			expect(response.status).toBe(400);
			expect(await loadConfigState(targetSession.organizationId)).toEqual({
				repositories: [],
				volumes: [],
				backupSchedules: [],
				notificationDestinations: [],
				backupScheduleMirrors: [],
				backupScheduleNotifications: [],
			});
			expect(sealSecret).not.toHaveBeenCalled();
		}
	});

	test("rejects notification targets blocked by the origin policy", async () => {
		config.webhookAllowedOrigins = [];
		const payload = await loadPayload();
		payload.notificationDestinations[0].config.url = "http://127.0.0.1:8080/webhook";
		const targetSession = await createTestSession();

		const response = await requestConfigImport(targetSession.headers, await encryptPayload(payload));

		expect(response.status).toBe(400);
		expect(
			await db.query.notificationDestinationsTable.findFirst({
				where: { organizationId: targetSession.organizationId },
			}),
		).toBeUndefined();
	});

	test("returns onboarding conflicts before decoding the export", async () => {
		const session = await createTestSession();
		await db
			.update(usersTable)
			.set({ hasDownloadedResticPassword: true })
			.where(eq(usersTable.id, session.user.id));

		const response = await requestConfigImport(session.headers, "invalid");

		expect(response.status).toBe(409);
		expect(await response.json()).toEqual({
			message: "Configuration import is only available during onboarding",
		});
		const org = await db.query.organization.findFirst({ where: { id: session.organizationId } });
		expect(org?.recoveryMaterialExportedAt).toBeNull();
	});

	test("rechecks onboarding eligibility atomically before writing", async () => {
		const targetSession = await createTestSession();
		const encryptedConfig = await loadEncryptedConfig();

		const responses = await Promise.all([
			requestConfigImport(targetSession.headers, encryptedConfig),
			requestConfigImport(targetSession.headers, encryptedConfig),
		]);

		expect(responses.map((response) => response.status).sort((left, right) => left - right)).toEqual([200, 409]);
		expect(
			await db.query.repositoriesTable.findMany({
				where: { organizationId: targetSession.organizationId },
			}),
		).toHaveLength(2);
	});

	test("rejects an import when the organization gained configuration", async () => {
		const targetSession = await createTestSession();
		await db.insert(repositoriesTable).values({
			id: crypto.randomUUID(),
			shortId: generateShortId(),
			name: "Existing repository",
			type: "rclone",
			config: { backend: "rclone", remote: "existing", path: "/" },
			organizationId: targetSession.organizationId,
		});

		const response = await requestConfigImport(targetSession.headers, "invalid");

		expect(response.status).toBe(409);
		expect(await response.json()).toEqual({
			message: "Organization already contains configuration",
		});
	});

	test("distinguishes unsupported versions from bad passphrases", async () => {
		const unsupportedSession = await createTestSession();
		const unsupportedResponse = await requestConfigImport(
			unsupportedSession.headers,
			await encryptPayload({ version: 99 }),
		);
		expect(unsupportedResponse.status).toBe(400);
		expect((await unsupportedResponse.json()).message).toContain(
			"Use a Zerobyte release that supports this export",
		);

		const sourceSession = await createTestSession();
		allowConfigExportPassword();
		const exportResponse = await requestConfigExport(sourceSession.headers);
		const targetSession = await createTestSession();
		const badSecretResponse = await requestConfigImport(
			targetSession.headers,
			await exportResponse.text(),
			"wrong-export-passphrase",
		);
		expect(badSecretResponse.status).toBe(400);
		expect(await badSecretResponse.json()).toEqual({
			message: "Invalid export file or passphrase",
		});
	});

	test("rejects unsupported encryption envelopes with conversion guidance", async () => {
		const targetSession = await createTestSession();
		const response = await requestConfigImport(targetSession.headers, "zbcfg:v99:{}");

		expect(response.status).toBe(400);
		expect((await response.json()).message).toContain("Use a Zerobyte release that supports this export");
	});

	test("rejects tampered exports before writing configuration", async () => {
		const encryptedConfig = await loadEncryptedConfig();
		const lastCharacter = encryptedConfig.at(-1);
		const tamperedConfig = `${encryptedConfig.slice(0, -1)}${lastCharacter === "A" ? "B" : "A"}`;
		const targetSession = await createTestSession();
		const response = await requestConfigImport(targetSession.headers, tamperedConfig);

		expect(response.status).toBe(400);
		expect(await response.json()).toEqual({ message: "Invalid export file or passphrase" });
		expect(
			await db.query.repositoriesTable.findFirst({
				where: { organizationId: targetSession.organizationId },
			}),
		).toBeUndefined();
	});
});
