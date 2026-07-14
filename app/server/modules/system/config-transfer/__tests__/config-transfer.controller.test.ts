import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { eq } from "drizzle-orm";
import { config } from "~/server/core/config";
import { db } from "~/server/db/db";
import { organization, repositoriesTable, usersTable } from "~/server/db/schema";
import * as authHelpers from "~/server/modules/auth/helpers";
import { cryptoUtils } from "~/server/utils/crypto";
import { generateShortId } from "~/server/utils/id";
import { createTestSession } from "~/test/helpers/auth";
import { decryptConfigTransferPayload } from "../envelope";
import { parseConfigTransferPayload } from "../payload";
import {
	allowConfigExportPassword,
	configTransferFixturePassphrase,
	createCompleteDurableConfiguration,
	encryptConfigTransferPayload,
	loadConfigTransferPayloadFixture,
	loadEncryptedConfigTransferFixture,
	loadNormalizedConfigState,
	requestConfigExport,
	requestConfigImport,
} from "./config-transfer-test-helpers";

beforeEach(() => {
	config.webhookAllowedOrigins = ["https://example.com", "https://hooks.slack.example.test"];
	vi.spyOn(cryptoUtils, "sealSecret").mockImplementation(async (value) => `encv1:test:${value}`);
	vi.spyOn(cryptoUtils, "resolveSecret").mockImplementation(async (value) =>
		value.startsWith("encv1:test:") ? value.slice("encv1:test:".length) : value,
	);
});

afterEach(() => {
	config.webhookAllowedOrigins = [];
	vi.restoreAllMocks();
});

describe("configuration transfer", () => {
	test("requires password re-authentication on export", async () => {
		const sourceSession = await createTestSession();
		vi.spyOn(authHelpers, "userHasPassword").mockResolvedValueOnce(true);
		vi.spyOn(authHelpers, "verifyUserPassword").mockResolvedValueOnce(false);

		const response = await requestConfigExport(sourceSession.headers, "wrong-password");

		expect(response.status).toBe(401);
		expect(await response.json()).toEqual({ message: "Invalid password" });
	});

	test("imports the frozen v1 fixture", async () => {
		const encryptedConfig = await loadEncryptedConfigTransferFixture();
		const fixture = await loadConfigTransferPayloadFixture();
		const decryptedPayload = JSON.parse(
			await decryptConfigTransferPayload(encryptedConfig, configTransferFixturePassphrase),
		);
		const targetSession = await createTestSession();

		expect(decryptedPayload).toEqual(fixture);
		const response = await requestConfigImport(targetSession.headers, encryptedConfig);

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({
			message: "Configuration imported successfully",
			imported: {
				repositories: fixture.repositories.length,
				volumes: fixture.volumes.length,
				backupSchedules: fixture.backupSchedules.length,
				notificationDestinations: fixture.notificationDestinations.length,
				backupScheduleMirrors: fixture.backupScheduleMirrors.length,
				backupScheduleNotifications: fixture.backupScheduleNotifications.length,
			},
			warnings: [],
		});

		const imported = await loadNormalizedConfigState(targetSession.organizationId);
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
					enabled: true,
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

		const storedSchedule = await db.query.backupSchedulesTable.findFirst({
			where: { organizationId: targetSession.organizationId },
		});
		expect(storedSchedule).toMatchObject({
			lastBackupAt: null,
			lastBackupStatus: null,
			lastBackupError: null,
			failureRetryCount: 0,
		});
		expect(storedSchedule?.nextBackupAt).toBeGreaterThan(Date.now());
	});

	test("exports the complete durable configuration without deployment secrets", async () => {
		const sourceSession = await createTestSession();
		await createCompleteDurableConfiguration(sourceSession.organizationId);
		allowConfigExportPassword();

		const response = await requestConfigExport(sourceSession.headers);

		expect(response.status).toBe(200);
		const encryptedConfig = await response.text();
		const decryptedPayload = await decryptConfigTransferPayload(encryptedConfig, configTransferFixturePassphrase);
		const payload = parseConfigTransferPayload(JSON.parse(decryptedPayload));
		const primaryRepositoryRef = payload.repositories.find(
			(repository) => repository.name === "Parity Primary Repository",
		)?.ref;
		const mirrorRepositoryRef = payload.repositories.find(
			(repository) => repository.name === "Parity Mirror Repository",
		)?.ref;
		const volumeRef = payload.volumes.find((volume) => volume.name === "Parity Volume")?.ref;
		const scheduleRef = payload.backupSchedules.find((schedule) => schedule.name === "Parity Schedule")?.ref;
		const destinationRef = payload.notificationDestinations.find(
			(destination) => destination.name === "Parity Notification",
		)?.ref;
		if (!primaryRepositoryRef || !mirrorRepositoryRef || !volumeRef || !scheduleRef || !destinationRef) {
			throw new Error("Expected every exported resource to have a transfer reference");
		}
		const repositories = [...payload.repositories].sort((first, second) => first.name.localeCompare(second.name));

		expect({ ...payload, repositories }).toEqual({
			resticPassword: "test-restic-password",
			repositories: [
				{
					ref: mirrorRepositoryRef,
					name: "Parity Mirror Repository",
					config: {
						backend: "rclone",
						remote: "parity-mirror",
						path: "/copy",
						customPassword: "parity-mirror-password",
						uploadLimit: { enabled: false, value: 7, unit: "Gbps" },
						downloadLimit: { enabled: true, value: 8, unit: "Mbps" },
					},
					compressionMode: "off",
					autoCheckEnabled: true,
				},
				{
					ref: primaryRepositoryRef,
					name: "Parity Primary Repository",
					config: {
						backend: "s3",
						endpoint: "https://s3.example.test",
						bucket: "parity-primary",
						accessKeyId: "parity-access-key",
						secretAccessKey: "parity-secret-key",
						customPassword: "parity-repository-password",
						cacert: "parity-ca-cert",
						insecureTls: true,
						isExistingRepository: true,
						uploadLimit: { enabled: true, value: 123, unit: "Mbps" },
						downloadLimit: { enabled: true, value: 45, unit: "Kbps" },
					},
					compressionMode: "max",
					autoCheckEnabled: false,
				},
			],
			volumes: [
				{
					ref: volumeRef,
					name: "Parity Volume",
					config: {
						backend: "sftp",
						host: "sftp.example.test",
						port: 2222,
						username: "parity-user",
						password: "parity-volume-password",
						privateKey: "parity-volume-private-key",
						path: "/source",
						readOnly: true,
						skipHostKeyCheck: false,
						knownHosts: "sftp.example.test ssh-ed25519 fixture-key",
						allowLegacySshRsa: false,
						allowUnsafeSymlinkTargets: true,
					},
					autoRemount: false,
				},
			],
			backupSchedules: [
				{
					ref: scheduleRef,
					name: "Parity Schedule",
					volumeRef,
					repositoryRef: primaryRepositoryRef,
					enabled: true,
					cronExpression: "*/15 * * * *",
					retentionPolicy: {
						keepLast: 11,
						keepHourly: 12,
						keepDaily: 13,
						keepWeekly: 14,
						keepMonthly: 15,
						keepYearly: 16,
						keepWithinDuration: "90d",
					},
					excludePatterns: ["*.tmp", "cache/**"],
					excludeIfPresent: [".nobackup", ".skip-backup"],
					includePaths: ["/Documents", "/Pictures"],
					includePatterns: ["**/*.md", "**/*.jpg"],
					oneFileSystem: true,
					customResticParams: ["--pack-size 64", "--ignore-inode"],
					compressionMode: "off",
					backupWebhooks: {
						pre: {
							url: "https://hooks.example.test/pre",
							headers: ["Authorization: Bearer pre-token"],
							body: '{"phase":"pre"}',
							insecureTls: true,
						},
						post: { url: "https://hooks.example.test/post", insecureTls: false },
					},
					maxRetries: 6,
					retryDelay: 75_000,
					sortOrder: 17,
				},
			],
			notificationDestinations: [
				{
					ref: destinationRef,
					name: "Parity Notification",
					enabled: false,
					config: {
						type: "slack",
						webhookUrl: "https://hooks.slack.example.test/parity",
						username: "Zerobyte",
						iconEmoji: ":floppy_disk:",
					},
				},
			],
			backupScheduleMirrors: [
				{
					scheduleRef,
					repositoryRef: mirrorRepositoryRef,
					enabled: false,
				},
			],
			backupScheduleNotifications: [
				{
					scheduleRef,
					destinationRef,
					notifyOnStart: true,
					notifyOnSuccess: false,
					notifyOnWarning: true,
					notifyOnFailure: false,
				},
			],
		});
		expect(decryptedPayload).not.toContain("encv1:");
		expect(decryptedPayload).toContain("parity-secret-key");
		expect(encryptedConfig).not.toContain("parity-secret-key");
		expect(encryptedConfig).not.toContain(config.appSecret);
	});


	test("preserves every current durable field on round trip", async () => {
		const sourceSession = await createTestSession();
		await createCompleteDurableConfiguration(sourceSession.organizationId);
		const sourceConfig = await loadNormalizedConfigState(sourceSession.organizationId);
		allowConfigExportPassword();

		const exportResponse = await requestConfigExport(sourceSession.headers);
		expect(exportResponse.status).toBe(200);
		const encryptedConfig = await exportResponse.text();
		const exportedPayload = await decryptConfigTransferPayload(encryptedConfig, configTransferFixturePassphrase);
		expect(exportedPayload).not.toContain("encv1:");
		expect(exportedPayload).toContain("parity-secret-key");
		expect(encryptedConfig).not.toContain("parity-secret-key");
		expect(encryptedConfig).not.toContain(config.appSecret);

		const targetSession = await createTestSession();
		const importResponse = await requestConfigImport(targetSession.headers, encryptedConfig);

		expect(importResponse.status).toBe(200);
		expect(await loadNormalizedConfigState(targetSession.organizationId)).toEqual(sourceConfig);

		const storedRepositories = await db.query.repositoriesTable.findMany({
			where: { organizationId: targetSession.organizationId },
		});
		const storedRepository = storedRepositories.find(
			(repository) => repository.name === "Parity Primary Repository",
		);
		const storedVolume = await db.query.volumesTable.findFirst({
			where: { organizationId: targetSession.organizationId },
		});
		const storedDestination = await db.query.notificationDestinationsTable.findFirst({
			where: { organizationId: targetSession.organizationId },
		});
		expect(storedRepository?.config.customPassword).toMatch(/^encv1:/);
		expect(storedRepository?.config.backend === "s3" && storedRepository.config.secretAccessKey).toMatch(/^encv1:/);
		expect(storedVolume?.config.backend === "sftp" && storedVolume.config.password).toMatch(/^encv1:/);
		expect(storedVolume?.config.backend === "sftp" && storedVolume.config.privateKey).toMatch(/^encv1:/);
		expect(storedDestination?.config.type === "slack" && storedDestination.config.webhookUrl).toMatch(/^encv1:/);
	});

	test("warns about local paths and disables dependent schedules", async () => {
		const payload = await loadConfigTransferPayloadFixture();
		payload.volumes[0].config = { backend: "directory", path: "/tmp/source-volume" };
		payload.repositories[0].config = { backend: "local", path: "/tmp/source-repository" };
		payload.repositories[1].config = { backend: "local", path: "/tmp/mirror-repository" };
		const targetSession = await createTestSession();

		const response = await requestConfigImport(targetSession.headers, await encryptConfigTransferPayload(payload));

		expect(response.status).toBe(200);
		expect(await response.json()).toMatchObject({
			message: "Configuration imported with warnings",
			warnings: expect.arrayContaining([
				'Volume "Fixture Volume" uses local directory path "/tmp/source-volume". Verify this path on this server before using it.',
				'Repository "Fixture Primary Repository" uses local path "/tmp/source-repository". Verify that this repository exists on this server before using it.',
				'Repository "Fixture Mirror Repository" uses local path "/tmp/mirror-repository". Verify that this repository exists on this server before using it.',
				'Disabled schedule "Fixture Nightly Backup" because it references volume "Fixture Volume", repository "Fixture Primary Repository", and repository "Fixture Mirror Repository". Re-enable it after validating those imported paths on this server.',
			]),
		});

		const schedule = await db.query.backupSchedulesTable.findFirst({
			where: { organizationId: targetSession.organizationId },
		});
		expect(schedule?.enabled).toBe(false);
	});

	test("rejects invalid schedule configuration before writing", async () => {
		const invalidCronPayload = await loadConfigTransferPayloadFixture();
		invalidCronPayload.backupSchedules[0].cronExpression = "not-a-cron";
		const invalidParamsPayload = await loadConfigTransferPayloadFixture();
		invalidParamsPayload.backupSchedules[0].customResticParams = ["--repo", "/tmp/repo"];

		for (const payload of [invalidCronPayload, invalidParamsPayload]) {
			const targetSession = await createTestSession();
			const response = await requestConfigImport(
				targetSession.headers,
				await encryptConfigTransferPayload(payload),
			);

			expect(response.status).toBe(400);
			expect(
				await db.query.backupSchedulesTable.findFirst({
					where: { organizationId: targetSession.organizationId },
				}),
			).toBeUndefined();
		}
	});

	test("normalizes imported volume and notification destination names", async () => {
		const payload = await loadConfigTransferPayloadFixture();
		payload.volumes[0].name = "  Imported volume  ";
		payload.notificationDestinations[0].name = "  Imported destination  ";
		const targetSession = await createTestSession();
		const encryptedConfig = await encryptConfigTransferPayload(payload);

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

	test("rejects invalid imported resource and schedule names before writing", async () => {
		const whitespaceVolumePayload = await loadConfigTransferPayloadFixture();
		whitespaceVolumePayload.volumes[0].name = " \t ";
		const whitespaceDestinationPayload = await loadConfigTransferPayloadFixture();
		whitespaceDestinationPayload.notificationDestinations[0].name = " \n ";
		const oversizedSchedulePayload = await loadConfigTransferPayloadFixture();
		oversizedSchedulePayload.backupSchedules[0].name = "a".repeat(129);
		const duplicateScheduleNamePayload = await loadConfigTransferPayloadFixture();
		const duplicateSchedule = {
			...duplicateScheduleNamePayload.backupSchedules[0],
			ref: "schedule:duplicate-name",
		};
		duplicateScheduleNamePayload.backupSchedules.push(duplicateSchedule);
		const invalidPayloads = [
			whitespaceVolumePayload,
			whitespaceDestinationPayload,
			oversizedSchedulePayload,
			duplicateScheduleNamePayload,
		];

		for (const payload of invalidPayloads) {
			const targetSession = await createTestSession();
			const encryptedConfig = await encryptConfigTransferPayload(payload);
			const sealSecret = vi.mocked(cryptoUtils.sealSecret);
			sealSecret.mockClear();

			const response = await requestConfigImport(targetSession.headers, encryptedConfig);

			expect(response.status).toBe(400);
			expect(await loadNormalizedConfigState(targetSession.organizationId)).toEqual({
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

	test("rejects a whitespace-only repository name before sealing or writing", async () => {
		const payload = await loadConfigTransferPayloadFixture();
		payload.repositories[0].name = " \t ";
		const targetSession = await createTestSession();
		const encryptedConfig = await encryptConfigTransferPayload(payload);
		const sealSecret = vi.mocked(cryptoUtils.sealSecret);
		sealSecret.mockClear();

		const response = await requestConfigImport(targetSession.headers, encryptedConfig);

		expect(response.status).toBe(400);
		expect(await loadNormalizedConfigState(targetSession.organizationId)).toEqual({
			repositories: [],
			volumes: [],
			backupSchedules: [],
			notificationDestinations: [],
			backupScheduleMirrors: [],
			backupScheduleNotifications: [],
		});
		expect(sealSecret).not.toHaveBeenCalled();
	});

	test("rejects duplicate volume names after normalization before sealing or writing", async () => {
		const payload = await loadConfigTransferPayloadFixture();
		const existingVolume = payload.volumes[0];
		if (!existingVolume) {
			throw new Error("Configuration fixture must include a volume");
		}
		const duplicateVolume = {
			...existingVolume,
			ref: "volume:duplicate-name",
			name: ` ${existingVolume.name} `,
		};
		payload.volumes.push(duplicateVolume);
		const targetSession = await createTestSession();
		const encryptedConfig = await encryptConfigTransferPayload(payload);
		const sealSecret = vi.mocked(cryptoUtils.sealSecret);
		sealSecret.mockClear();

		const response = await requestConfigImport(targetSession.headers, encryptedConfig);

		expect(response.status).toBe(400);
		expect(await loadNormalizedConfigState(targetSession.organizationId)).toEqual({
			repositories: [],
			volumes: [],
			backupSchedules: [],
			notificationDestinations: [],
			backupScheduleMirrors: [],
			backupScheduleNotifications: [],
		});
		expect(sealSecret).not.toHaveBeenCalled();
	});

	test("rejects invalid mirror configuration before writing", async () => {
		const primaryAsMirrorPayload = await loadConfigTransferPayloadFixture();
		primaryAsMirrorPayload.backupScheduleMirrors[0].repositoryRef =
			primaryAsMirrorPayload.backupSchedules[0].repositoryRef;

		const incompatibleCredentialsPayload = await loadConfigTransferPayloadFixture();
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
			const response = await requestConfigImport(
				targetSession.headers,
				await encryptConfigTransferPayload(payload),
			);

			expect(response.status).toBe(400);
			expect(await loadNormalizedConfigState(targetSession.organizationId)).toEqual({
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
		const payload = await loadConfigTransferPayloadFixture();
		payload.notificationDestinations[0].config.url = "http://127.0.0.1:8080/webhook";
		const targetSession = await createTestSession();

		const response = await requestConfigImport(targetSession.headers, await encryptConfigTransferPayload(payload));

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
	});

	test("rechecks onboarding eligibility atomically before writing", async () => {
		const targetSession = await createTestSession();
		const encryptedConfig = await loadEncryptedConfigTransferFixture();

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
			await encryptConfigTransferPayload({ version: 99 }),
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
		const encryptedConfig = await loadEncryptedConfigTransferFixture();
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

	test("records recovery-key completion after a successful export", async () => {
		const sourceSession = await createTestSession();
		await db
			.update(usersTable)
			.set({ hasDownloadedResticPassword: false })
			.where(eq(usersTable.id, sourceSession.user.id));
		allowConfigExportPassword();

		const response = await requestConfigExport(sourceSession.headers);

		expect(response.status).toBe(200);
		const user = await db.query.usersTable.findFirst({ where: { id: sourceSession.user.id } });
		expect(user?.hasDownloadedResticPassword).toBe(true);
	});

	test("does not record recovery-key completion when export fails", async () => {
		const sourceSession = await createTestSession();
		await db
			.update(usersTable)
			.set({ hasDownloadedResticPassword: false })
			.where(eq(usersTable.id, sourceSession.user.id));
		await db.update(organization).set({ metadata: null }).where(eq(organization.id, sourceSession.organizationId));
		allowConfigExportPassword();

		const response = await requestConfigExport(sourceSession.headers);

		expect(response.status).toBe(404);
		expect(await response.json()).toEqual({ message: "Organization Restic password not found" });
		const user = await db.query.usersTable.findFirst({ where: { id: sourceSession.user.id } });
		expect(user?.hasDownloadedResticPassword).toBe(false);
	});

	test("preserves pre and post backup webhook TLS overrides", async () => {
		const sourceSession = await createTestSession();
		await createCompleteDurableConfiguration(sourceSession.organizationId);
		allowConfigExportPassword();

		const response = await requestConfigExport(sourceSession.headers);

		expect(response.status).toBe(200);
		const encryptedConfig = await response.text();
		const decryptedPayload = await decryptConfigTransferPayload(encryptedConfig, configTransferFixturePassphrase);
		const payload = parseConfigTransferPayload(JSON.parse(decryptedPayload));
		expect(payload.backupSchedules[0]?.backupWebhooks).toEqual({
			pre: {
				url: "https://hooks.example.test/pre",
				headers: ["Authorization: Bearer pre-token"],
				body: '{"phase":"pre"}',
				insecureTls: true,
			},
			post: { url: "https://hooks.example.test/post", insecureTls: false },
		});
	});
});
