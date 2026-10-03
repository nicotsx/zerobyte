import type { RepositoryBackend, RepositoryConfig } from "@zerobyte/core/restic";
import type { BackendConfig, BackendType } from "@zerobyte/contracts/volumes";
import { describe, expect, expectTypeOf, test } from "vitest";
import { defaultNotificationTemplates } from "~/lib/notification-templates/catalog";
import type { NotificationConfig, NotificationType } from "~/schemas/notifications";
import { decodeConfigTransferPayloadV1, encodeConfigTransferPayloadV1 } from "../v1/codec";
import { UnsupportedConfigTransferVersionError } from "../errors";
import type { ConfigTransferModel } from "../model";
import {
	CURRENT_CONFIG_TRANSFER_PAYLOAD_VERSION,
	encodeCurrentConfigTransferPayload,
	parseConfigTransferPayload,
} from "../payload";
import { configTransferPayloadV1Schema } from "../v1/payload";
import { decodeConfigTransferPayloadV2, encodeConfigTransferPayloadV2 } from "../v2/codec";
import { configTransferPayloadV2Schema } from "../v2/payload";
import { loadPayload, loadPayloadV2 } from "./config-transfer-test-helpers";

type CurrentEncodedModel = Omit<ReturnType<typeof encodeCurrentConfigTransferPayload>, "version">;

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
		templates: structuredClone(defaultNotificationTemplates),
	})),
	backupScheduleMirrors: [],
	backupScheduleNotifications: [],
});

describe("config transfer payload graph", () => {
	test("requires a wire contract update when the current transfer model changes", () => {
		expectTypeOf<CurrentEncodedModel>().toEqualTypeOf<ConfigTransferModel>();
	});

	test("decodes the historical v1 fixture into the current import model", async () => {
		const fixture = await loadPayload();

		const model = parseConfigTransferPayload(fixture);
		const historicalModel = {
			...model,
			notificationDestinations: model.notificationDestinations.map(({ templates, ...destination }) => {
				expect(templates).toMatchSnapshot("frozen v1 to v2 defaults");

				return destination;
			}),
		};

		expect(historicalModel).toMatchSnapshot();
	});

	test("round-trips the permanent v2 fixture with saved template text", async () => {
		const fixture = await loadPayloadV2();
		const model = decodeConfigTransferPayloadV2(configTransferPayloadV2Schema.parse(fixture));

		expect(encodeConfigTransferPayloadV2(model)).toEqual(fixture);
		expect(encodeCurrentConfigTransferPayload(parseConfigTransferPayload(fixture))).toEqual(fixture);
		expect(model.notificationDestinations[0].templates.backup_success.title).toBe("Saved backup: {{schedule}}");
	});

	test.each(["missing", "extra", "null"])("rejects %s template sets in v2", async (variant) => {
		const fixture = await loadPayloadV2();
		const templates = fixture.notificationDestinations[0].templates;
		if (variant === "missing") delete templates.test;
		if (variant === "extra") templates.unknown = { title: "", body: "" };
		if (variant === "null") fixture.notificationDestinations[0].templates = null;

		expect(() => parseConfigTransferPayload(fixture)).toThrow();
	});

	test("directs newer-format imports to update before validating their unknown shape", () => {
		const futurePayload = { version: CURRENT_CONFIG_TRANSFER_PAYLOAD_VERSION + 1, futureConfiguration: {} };

		expect(() => parseConfigTransferPayload(futurePayload)).toThrow(UnsupportedConfigTransferVersionError);
		expect(() => parseConfigTransferPayload(futurePayload)).toThrow("Update Zerobyte to the latest release");
	});

	test.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])("rejects invalid version %s as malformed", (version) => {
		expect(() => parseConfigTransferPayload({ version })).toThrow();
		expect(() => parseConfigTransferPayload({ version })).not.toThrow(UnsupportedConfigTransferVersionError);
	});

	test("encodes every current backend and notification variant in the current format", () => {
		const encoded = encodeCurrentConfigTransferPayload(createVariantCoveragePayload());

		expect(encoded.version).toBe(CURRENT_CONFIG_TRANSFER_PAYLOAD_VERSION);

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

	test("rejects unversioned fields instead of silently dropping them during export", async () => {
		const payload = parseConfigTransferPayload(await loadPayload());
		const extendedPayload = {
			...payload,
			repositories: payload.repositories.map((repository) => ({
				...repository,
				unreleasedFutureField: true,
			})),
		};

		expect(() => encodeCurrentConfigTransferPayload(extendedPayload)).toThrow("unreleasedFutureField");
	});

	test("keeps the canonical v1 fixture identical across decode and encode", async () => {
		const fixture = await loadPayload();

		const encoded = encodeConfigTransferPayloadV1(
			decodeConfigTransferPayloadV1(configTransferPayloadV1Schema.parse(fixture)),
		);

		expect(encoded).toEqual(fixture);
	});

	test("requires the complete canonical v1 representation", async () => {
		const payload = await loadPayload();
		delete payload.repositories[0].autoCheckEnabled;

		expect(() => parseConfigTransferPayload(payload)).toThrow();
	});

	test("keeps repository bandwidth limits in one canonical location", async () => {
		const payload = await loadPayload();
		payload.repositories[0].uploadLimit = { enabled: true, value: 999, unit: "Gbps" };

		expect(() => parseConfigTransferPayload(payload)).toThrow();
	});

	test("rejects values outside the v1 storage contract", async () => {
		const invalidBandwidth = await loadPayload();
		invalidBandwidth.repositories[0].config.uploadLimit.value = -1;
		const invalidRetries = await loadPayload();
		invalidRetries.backupSchedules[0].maxRetries = 33;

		expect(() => parseConfigTransferPayload(invalidBandwidth)).toThrow();
		expect(() => parseConfigTransferPayload(invalidRetries)).toThrow();
	});

	test("preserves fractional retry counts accepted by current schedules", async () => {
		const payload = await loadPayload();
		payload.backupSchedules[0].maxRetries = 1.5;

		const encoded = encodeCurrentConfigTransferPayload(parseConfigTransferPayload(payload));

		expect(encoded.backupSchedules[0].maxRetries).toBe(1.5);
	});

	test("preserves fractional retry delays accepted by current schedules", async () => {
		const payload = await loadPayload();
		payload.backupSchedules[0].retryDelay = 60_000.5;

		const encoded = encodeCurrentConfigTransferPayload(parseConfigTransferPayload(payload));

		expect(encoded.backupSchedules[0].retryDelay).toBe(60_000.5);
	});

	test("rejects duplicate entity references", async () => {
		const payload = await loadPayload();
		payload.repositories[1].ref = payload.repositories[0].ref;

		expect(() => parseConfigTransferPayload(payload)).toThrow("Duplicate repository reference");
	});

	test("rejects unresolved relationship references", async () => {
		const payload = await loadPayload();
		payload.backupSchedules[0].volumeRef = "volume:missing";

		expect(() => parseConfigTransferPayload(payload)).toThrow("Unknown volume reference");
	});

	test("rejects duplicate relationship assignments", async () => {
		const payload = await loadPayload();
		payload.backupScheduleMirrors.push({ ...payload.backupScheduleMirrors[0] });

		expect(() => parseConfigTransferPayload(payload)).toThrow("Duplicate backup schedule mirror");
	});

	test("rejects a schedule's primary repository as its mirror", async () => {
		const payload = await loadPayload();
		payload.backupScheduleMirrors[0].repositoryRef = payload.backupSchedules[0].repositoryRef;

		expect(() => parseConfigTransferPayload(payload)).toThrow(
			"Backup schedule cannot mirror its primary repository",
		);
	});

	test("keeps the v1 wire contract frozen", async () => {
		const payload = await loadPayload();
		payload.repositories[0].config.unreleasedFutureField = true;

		expect(() => parseConfigTransferPayload(payload)).toThrow();
	});
});
