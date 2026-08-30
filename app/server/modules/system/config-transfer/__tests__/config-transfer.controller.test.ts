import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { eq } from "drizzle-orm";
import { config } from "~/server/core/config";
import { db } from "~/server/db/db";
import { organization, usersTable } from "~/server/db/schema";
import * as authHelpers from "~/server/modules/auth/helpers";
import { cryptoUtils } from "~/server/utils/crypto";
import { createTestSession } from "~/test/helpers/auth";
import { decryptConfigTransferPayload } from "../envelope";
import { parseConfigTransferPayload } from "../payload";
import { allowConfigExportPassword, fixturePassphrase, requestConfigExport } from "./config-transfer-test-helpers";
import { seedConfig } from "./config-transfer-fixture-test-helpers";

beforeEach(() => {
	vi.spyOn(cryptoUtils, "sealSecret").mockImplementation(async (value) => `encv1:test:${value}`);
	vi.spyOn(cryptoUtils, "resolveSecret").mockImplementation(async (value) =>
		value.startsWith("encv1:test:") ? value.slice("encv1:test:".length) : value,
	);
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe("configuration export", () => {
	test("requires password re-authentication on export", async () => {
		const sourceSession = await createTestSession();
		vi.spyOn(authHelpers, "userHasPassword").mockResolvedValueOnce(true);
		vi.spyOn(authHelpers, "verifyUserPassword").mockResolvedValueOnce(false);

		const response = await requestConfigExport(sourceSession.headers, "wrong-password");

		expect(response.status).toBe(401);
		expect(await response.json()).toEqual({ message: "Invalid password" });
	});

	test("exports the complete durable configuration without deployment secrets", async () => {
		const sourceSession = await createTestSession();
		const { schedule } = await seedConfig(sourceSession.organizationId);
		allowConfigExportPassword();

		const response = await requestConfigExport(sourceSession.headers);

		expect(response.status).toBe(200);
		const encryptedConfig = await response.text();
		const decryptedPayload = await decryptConfigTransferPayload(encryptedConfig, fixturePassphrase);
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
					shortId: schedule.shortId,
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
		const org = await db.query.organization.findFirst({ where: { id: sourceSession.organizationId } });
		expect(org?.recoveryKeyExportedAt).toBeInstanceOf(Date);
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
		const org = await db.query.organization.findFirst({ where: { id: sourceSession.organizationId } });
		expect(org?.recoveryKeyExportedAt).toBeNull();
	});

	test("preserves pre and post backup webhook TLS overrides", async () => {
		const sourceSession = await createTestSession();
		await seedConfig(sourceSession.organizationId);
		allowConfigExportPassword();

		const response = await requestConfigExport(sourceSession.headers);

		expect(response.status).toBe(200);
		const encryptedConfig = await response.text();
		const decryptedPayload = await decryptConfigTransferPayload(encryptedConfig, fixturePassphrase);
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
