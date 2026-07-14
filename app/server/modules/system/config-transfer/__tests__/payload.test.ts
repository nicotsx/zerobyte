import type { RepositoryBackend, RepositoryConfig } from "@zerobyte/core/restic";
import type { BackendConfig, BackendType } from "@zerobyte/contracts/volumes";
import { describe, expect, expectTypeOf, test } from "vitest";
import type { NotificationConfig, NotificationType } from "~/schemas/notifications";
import type { BackupSchedule } from "~/server/db/schema";
import type { ConfigTransferModel } from "../model";
import { encodeCurrentConfigTransferPayload, parseConfigTransferPayload } from "../payload";
import { loadConfigTransferPayloadFixture } from "./config-transfer-test-helpers";

type CurrentEncodedPayload = ReturnType<typeof encodeCurrentConfigTransferPayload>;

const repositoryConfigs = {
	s3: {
		backend: "s3",
		endpoint: "https://s3.example.test",
		bucket: "bucket",
		accessKeyId: "access-key",
		secretAccessKey: "secret-key",
	},
	r2: {
		backend: "r2",
		endpoint: "https://r2.example.test",
		bucket: "bucket",
		accessKeyId: "access-key",
		secretAccessKey: "secret-key",
	},
	local: { backend: "local", path: "/backups" },
	gcs: {
		backend: "gcs",
		bucket: "bucket",
		projectId: "project",
		credentialsJson: '{"type":"service_account"}',
	},
	azure: {
		backend: "azure",
		container: "container",
		accountName: "account",
		accountKey: "account-key",
	},
	rclone: { backend: "rclone", remote: "remote", path: "/backups" },
	rest: { backend: "rest", url: "https://rest.example.test" },
	sftp: {
		backend: "sftp",
		host: "sftp.example.test",
		port: 22,
		user: "user",
		path: "/backups",
		privateKey: "private-key",
		skipHostKeyCheck: false,
		allowLegacySshRsa: false,
	},
} satisfies Record<RepositoryBackend, RepositoryConfig>;

const volumeConfigs = {
	nfs: {
		backend: "nfs",
		server: "nfs.example.test",
		exportPath: "/exports",
		port: 2049,
		version: "4",
	},
	smb: {
		backend: "smb",
		server: "smb.example.test",
		share: "backups",
		mapToContainerUidGid: false,
		vers: "auto",
		port: 445,
	},
	directory: { backend: "directory", path: "/data" },
	webdav: {
		backend: "webdav",
		server: "webdav.example.test",
		path: "/data",
		port: 443,
		ssl: true,
	},
	rclone: { backend: "rclone", remote: "remote", path: "/data" },
	sftp: {
		backend: "sftp",
		host: "sftp.example.test",
		port: 22,
		username: "user",
		path: "/data",
		skipHostKeyCheck: false,
		knownHosts: "sftp.example.test ssh-ed25519 fixture-key",
		allowLegacySshRsa: false,
		allowUnsafeSymlinkTargets: true,
	},
} satisfies Record<BackendType, BackendConfig>;

const notificationConfigs = {
	email: {
		type: "email",
		smtpHost: "smtp.example.test",
		smtpPort: 587,
		from: "zerobyte@example.test",
		to: ["admin@example.test"],
		useTLS: true,
	},
	slack: { type: "slack", webhookUrl: "https://hooks.slack.example.test/fixture" },
	discord: { type: "discord", webhookUrl: "https://discord.example.test/fixture" },
	gotify: {
		type: "gotify",
		serverUrl: "https://gotify.example.test",
		token: "token",
		priority: 5,
	},
	ntfy: { type: "ntfy", topic: "backups", priority: "default" },
	pushover: { type: "pushover", userKey: "user-key", apiToken: "api-token", priority: 0 },
	telegram: { type: "telegram", botToken: "bot-token", chatId: "chat-id" },
	generic: { type: "generic", url: "https://example.test/webhook", method: "POST" },
	custom: { type: "custom", shoutrrrUrl: "smtp://example.test" },
} satisfies Record<NotificationType, NotificationConfig>;

const createVariantCoveragePayload = (): ConfigTransferModel => ({
	resticPassword: "restic-password",
	repositories: Object.entries(repositoryConfigs).map(([backend, config]) => ({
		ref: `repository:${backend}`,
		name: `${backend} repository`,
		config,
		compressionMode: "auto",
		autoCheckEnabled: false,
		uploadLimit: { enabled: false, value: 1, unit: "Mbps" },
		downloadLimit: { enabled: false, value: 1, unit: "Mbps" },
	})),
	volumes: Object.entries(volumeConfigs).map(([backend, config]) => ({
		ref: `volume:${backend}`,
		name: `${backend} volume`,
		config,
		autoRemount: true,
	})),
	backupSchedules: [],
	notificationDestinations: Object.entries(notificationConfigs).map(([type, config]) => ({
		ref: `notification:${type}`,
		name: `${type} notification`,
		enabled: true,
		config,
	})),
	backupScheduleMirrors: [],
	backupScheduleNotifications: [],
});

describe("config transfer payload graph", () => {
	test("requires a deliberate wire-version decision when persisted config types change", () => {
		// A mismatch requires either extending the current wire version or adding a new version.
		expectTypeOf<CurrentEncodedPayload["repositories"][number]["config"]>().toEqualTypeOf<RepositoryConfig>();
		expectTypeOf<CurrentEncodedPayload["volumes"][number]["config"]>().toEqualTypeOf<BackendConfig>();
		expectTypeOf<
			CurrentEncodedPayload["notificationDestinations"][number]["config"]
		>().toEqualTypeOf<NotificationConfig>();
		expectTypeOf<CurrentEncodedPayload["backupSchedules"][number]["backupWebhooks"]>().toEqualTypeOf<
			BackupSchedule["backupWebhooks"]
		>();
		expectTypeOf<CurrentEncodedPayload["backupSchedules"][number]["retentionPolicy"]>().toEqualTypeOf<
			BackupSchedule["retentionPolicy"]
		>();
		expectTypeOf<CurrentEncodedPayload["backupSchedules"][number]["compressionMode"]>().toEqualTypeOf<
			BackupSchedule["compressionMode"]
		>();
	});

	test("encodes every current backend and notification variant in v1", () => {
		const encoded = encodeCurrentConfigTransferPayload(createVariantCoveragePayload());

		expect(encoded.repositories.map(({ config }) => config.backend).sort()).toEqual(
			Object.keys(repositoryConfigs).sort(),
		);
		expect(encoded.volumes.map(({ config }) => config.backend).sort()).toEqual(Object.keys(volumeConfigs).sort());
		expect(encoded.notificationDestinations.map(({ config }) => config.type).sort()).toEqual(
			Object.keys(notificationConfigs).sort(),
		);
		expect(encoded.volumes.find(({ config }) => config.backend === "sftp")?.config).toMatchObject({
			allowUnsafeSymlinkTargets: true,
		});
	});

	test("defaults fields omitted by older v1 exports", () => {
		const currentPayload = encodeCurrentConfigTransferPayload(createVariantCoveragePayload());
		const olderPayload = {
			...currentPayload,
			repositories: currentPayload.repositories.map((repository) => {
				const { autoCheckEnabled: _omitted, ...olderRepository } = repository;
				return olderRepository;
			}),
			volumes: currentPayload.volumes.map((volume) => {
				if (volume.config.backend !== "sftp") {
					return volume;
				}

				const { allowUnsafeSymlinkTargets: _omitted, ...config } = volume.config;
				return { ...volume, config };
			}),
		};

		const parsed = parseConfigTransferPayload(olderPayload);

		expect(parsed.volumes.find(({ config }) => config.backend === "sftp")?.config).toMatchObject({
			allowUnsafeSymlinkTargets: false,
		});
		expect(parsed.repositories.map((repository) => repository.autoCheckEnabled)).toEqual(
			currentPayload.repositories.map(() => true),
		);
	});

	test("rejects values outside the v1 storage contract", async () => {
		const invalidBandwidth = await loadConfigTransferPayloadFixture();
		invalidBandwidth.repositories[0].uploadLimit.value = -1;
		const invalidRetries = await loadConfigTransferPayloadFixture();
		invalidRetries.backupSchedules[0].maxRetries = 33;

		expect(() => parseConfigTransferPayload(invalidBandwidth)).toThrow();
		expect(() => parseConfigTransferPayload(invalidRetries)).toThrow();
	});

	test("rejects duplicate entity references", async () => {
		const payload = await loadConfigTransferPayloadFixture();
		payload.repositories[1].ref = payload.repositories[0].ref;

		expect(() => parseConfigTransferPayload(payload)).toThrow("Duplicate repository reference");
	});

	test("rejects unresolved relationship references", async () => {
		const payload = await loadConfigTransferPayloadFixture();
		payload.backupSchedules[0].volumeRef = "volume:missing";

		expect(() => parseConfigTransferPayload(payload)).toThrow("Unknown volume reference");
	});

	test("rejects duplicate relationship assignments", async () => {
		const payload = await loadConfigTransferPayloadFixture();
		payload.backupScheduleMirrors.push({ ...payload.backupScheduleMirrors[0] });

		expect(() => parseConfigTransferPayload(payload)).toThrow("Duplicate backup schedule mirror");
	});

	test("keeps the v1 wire contract frozen", async () => {
		const payload = await loadConfigTransferPayloadFixture();
		payload.repositories[0].config.unreleasedFutureField = true;

		expect(() => parseConfigTransferPayload(payload)).toThrow();
	});
});
