import { readFile } from "node:fs/promises";
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { createApp } from "~/server/app";
import { createTestSession, createTestSessionWithGlobalAdmin, getAuthHeaders } from "~/test/helpers/auth";
import { systemService } from "../system.service";
import * as authHelpers from "~/server/modules/auth/helpers";
import { db } from "~/server/db/db";
import {
	appMetadataTable,
	backupScheduleMirrorsTable,
	backupScheduleNotificationsTable,
	backupSchedulesTable,
	notificationDestinationsTable,
	organization,
	repositoriesTable,
	sessionsTable,
	usersTable,
	volumesTable,
} from "~/server/db/schema";
import { generateShortId } from "~/server/utils/id";
import { eq } from "drizzle-orm";
import { cryptoUtils } from "~/server/utils/crypto";
import { decryptNotificationConfig } from "~/server/modules/notifications/notification-config-secrets";
import { decryptRepositoryConfig } from "~/server/modules/repositories/repository-config-secrets";
import { decryptVolumeConfig } from "~/server/modules/volumes/volume-config-secrets";
import { config } from "~/server/core/config";
import { PASSWORD_LOGIN_DISABLED_KEY } from "~/server/core/constants";

const app = createApp();
const configTransferFixtureSourceAppSecret = "fixture-source-app-secret-for-config-transfer-v1";

let session: Awaited<ReturnType<typeof createTestSession>>;
let globalAdminSession: Awaited<ReturnType<typeof createTestSessionWithGlobalAdmin>>;

const createDesktopTestSession = async () => {
	const desktopAuthSession = await createTestSession();
	await db
		.update(sessionsTable)
		.set({ authSource: "desktop-session" })
		.where(eq(sessionsTable.token, desktopAuthSession.session.token));
	return desktopAuthSession;
};

beforeAll(async () => {
	session = await createTestSession();
	globalAdminSession = await createTestSessionWithGlobalAdmin();
});

afterEach(() => {
	config.runtime = "server";
	vi.restoreAllMocks();
});

const repositoryDurableFields = [
	"name",
	"type",
	"config",
	"compressionMode",
	"uploadLimitEnabled",
	"uploadLimitValue",
	"uploadLimitUnit",
	"downloadLimitEnabled",
	"downloadLimitValue",
	"downloadLimitUnit",
];

const repositoryIgnoredFields = [
	"id",
	"shortId",
	"provisioningId",
	"status",
	"lastChecked",
	"lastError",
	"doctorResult",
	"stats",
	"statsUpdatedAt",
	"createdAt",
	"updatedAt",
	"organizationId",
];

const volumeDurableFields = ["name", "type", "config", "autoRemount"];

const volumeIgnoredFields = [
	"agentId",
	"id",
	"shortId",
	"provisioningId",
	"status",
	"lastError",
	"lastHealthCheck",
	"createdAt",
	"updatedAt",
	"organizationId",
];

const backupScheduleDurableFields = [
	"name",
	"volumeId",
	"repositoryId",
	"enabled",
	"cronExpression",
	"retentionPolicy",
	"excludePatterns",
	"excludeIfPresent",
	"includePaths",
	"includePatterns",
	"oneFileSystem",
	"customResticParams",
	"backupWebhooks",
	"sortOrder",
	"maxRetries",
	"retryDelay",
];

const backupScheduleIgnoredFields = [
	"id",
	"shortId",
	"lastBackupAt",
	"lastBackupStatus",
	"lastBackupError",
	"nextBackupAt",
	"failureRetryCount",
	"createdAt",
	"updatedAt",
	"organizationId",
];

const notificationDestinationDurableFields = ["name", "enabled", "type", "config"];

const notificationDestinationIgnoredFields = [
	"id",
	"status",
	"lastChecked",
	"lastError",
	"createdAt",
	"updatedAt",
	"organizationId",
];

const backupScheduleMirrorDurableFields = ["scheduleId", "repositoryId", "enabled"];

const backupScheduleMirrorIgnoredFields = ["id", "lastCopyAt", "lastCopyStatus", "lastCopyError", "createdAt"];

const backupScheduleNotificationDurableFields = [
	"scheduleId",
	"destinationId",
	"notifyOnStart",
	"notifyOnSuccess",
	"notifyOnWarning",
	"notifyOnFailure",
];

const backupScheduleNotificationIgnoredFields = ["createdAt"];

const expectKnownConfigFields = (record: object, durableFields: string[], ignoredFields: string[]) => {
	expect(Object.keys(record).sort()).toEqual([...durableFields, ...ignoredFields].sort());
};

const sortConfigRecords = <T>(items: T[]) =>
	[...items].sort((first, second) => JSON.stringify(first).localeCompare(JSON.stringify(second)));

const getMappedName = <T>(namesById: Map<T, string>, id: T, label: string) => {
	const name = namesById.get(id);

	if (!name) {
		throw new Error(`Expected ${label} ${String(id)} to be present`);
	}

	return name;
};

const createCompleteDurableConfiguration = async (organizationId: string) => {
	const [volume] = await db
		.insert(volumesTable)
		.values({
			shortId: generateShortId(),
			name: "Parity Volume",
			type: "rclone",
			config: { backend: "rclone", remote: "parity-volume", path: "/source", readOnly: true },
			status: "mounted",
			lastError: "stale volume error",
			lastHealthCheck: 111,
			autoRemount: false,
			organizationId,
		})
		.returning();

	const [primaryRepository] = await db
		.insert(repositoriesTable)
		.values({
			id: crypto.randomUUID(),
			shortId: generateShortId(),
			name: "Parity Primary Repository",
			type: "s3",
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
			},
			compressionMode: "max",
			status: "error",
			lastChecked: 222,
			lastError: "stale repository error",
			uploadLimitEnabled: true,
			uploadLimitValue: 123,
			uploadLimitUnit: "Mbps",
			downloadLimitEnabled: true,
			downloadLimitValue: 45,
			downloadLimitUnit: "Kbps",
			organizationId,
		})
		.returning();

	const [mirrorRepository] = await db
		.insert(repositoriesTable)
		.values({
			id: crypto.randomUUID(),
			shortId: generateShortId(),
			name: "Parity Mirror Repository",
			type: "rclone",
			config: {
				backend: "rclone",
				remote: "parity-mirror",
				path: "/copy",
				customPassword: "parity-mirror-password",
			},
			compressionMode: "off",
			status: "healthy",
			uploadLimitEnabled: false,
			uploadLimitValue: 7,
			uploadLimitUnit: "Gbps",
			downloadLimitEnabled: true,
			downloadLimitValue: 8,
			downloadLimitUnit: "Mbps",
			organizationId,
		})
		.returning();

	const [schedule] = await db
		.insert(backupSchedulesTable)
		.values({
			shortId: generateShortId(),
			name: "Parity Schedule",
			volumeId: volume.id,
			repositoryId: primaryRepository.id,
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
			lastBackupAt: 333,
			lastBackupStatus: "warning",
			lastBackupError: "stale schedule error",
			nextBackupAt: 444,
			oneFileSystem: true,
			customResticParams: ["--tag", "parity"],
			backupWebhooks: {
				pre: {
					url: "https://hooks.example.test/pre",
					headers: ["Authorization: Bearer pre-token"],
					body: '{"phase":"pre"}',
				},
				post: {
					url: "https://hooks.example.test/post",
				},
			},
			sortOrder: 17,
			failureRetryCount: 5,
			maxRetries: 6,
			retryDelay: 75_000,
			organizationId,
		})
		.returning();

	const [destination] = await db
		.insert(notificationDestinationsTable)
		.values({
			name: "Parity Notification",
			enabled: false,
			type: "slack",
			config: {
				type: "slack",
				webhookUrl: "https://hooks.slack.example.test/parity",
				username: "Zerobyte",
				iconEmoji: ":floppy_disk:",
			},
			organizationId,
		})
		.returning();

	await db.insert(backupScheduleMirrorsTable).values({
		scheduleId: schedule.id,
		repositoryId: mirrorRepository.id,
		enabled: false,
		lastCopyAt: 555,
		lastCopyStatus: "in_progress",
		lastCopyError: "stale copy error",
	});

	await db.insert(backupScheduleNotificationsTable).values({
		scheduleId: schedule.id,
		destinationId: destination.id,
		notifyOnStart: true,
		notifyOnSuccess: false,
		notifyOnWarning: true,
		notifyOnFailure: false,
	});
};

const loadNormalizedConfigState = async (organizationId: string) => {
	const [repositories, volumes, backupSchedules, notificationDestinations] = await Promise.all([
		db.query.repositoriesTable.findMany({ where: { organizationId } }),
		db.query.volumesTable.findMany({ where: { organizationId } }),
		db.query.backupSchedulesTable.findMany({ where: { organizationId } }),
		db.query.notificationDestinationsTable.findMany({ where: { organizationId } }),
	]);

	const scheduleIds = backupSchedules.map((schedule) => schedule.id);
	const [backupScheduleMirrors, backupScheduleNotifications] =
		scheduleIds.length === 0
			? [[], []]
			: await Promise.all([
					db.query.backupScheduleMirrorsTable.findMany({ where: { scheduleId: { in: scheduleIds } } }),
					db.query.backupScheduleNotificationsTable.findMany({ where: { scheduleId: { in: scheduleIds } } }),
				]);

	for (const repository of repositories) {
		expectKnownConfigFields(repository, repositoryDurableFields, repositoryIgnoredFields);
	}

	for (const volume of volumes) {
		expectKnownConfigFields(volume, volumeDurableFields, volumeIgnoredFields);
	}

	for (const schedule of backupSchedules) {
		expectKnownConfigFields(schedule, backupScheduleDurableFields, backupScheduleIgnoredFields);
	}

	for (const destination of notificationDestinations) {
		expectKnownConfigFields(destination, notificationDestinationDurableFields, notificationDestinationIgnoredFields);
	}

	for (const mirror of backupScheduleMirrors) {
		expectKnownConfigFields(mirror, backupScheduleMirrorDurableFields, backupScheduleMirrorIgnoredFields);
	}

	for (const notification of backupScheduleNotifications) {
		expectKnownConfigFields(
			notification,
			backupScheduleNotificationDurableFields,
			backupScheduleNotificationIgnoredFields,
		);
	}

	const volumeNamesById = new Map(volumes.map((volume) => [volume.id, volume.name]));
	const repositoryNamesById = new Map(repositories.map((repository) => [repository.id, repository.name]));
	const scheduleNamesById = new Map(backupSchedules.map((schedule) => [schedule.id, schedule.name]));
	const destinationNamesById = new Map(
		notificationDestinations.map((destination) => [destination.id, destination.name]),
	);

	return {
		repositories: sortConfigRecords(
			await Promise.all(
				repositories.map(async (repository) => ({
					name: repository.name,
					type: repository.type,
					config: await decryptRepositoryConfig(repository.config),
					compressionMode: repository.compressionMode,
					uploadLimitEnabled: repository.uploadLimitEnabled,
					uploadLimitValue: repository.uploadLimitValue,
					uploadLimitUnit: repository.uploadLimitUnit,
					downloadLimitEnabled: repository.downloadLimitEnabled,
					downloadLimitValue: repository.downloadLimitValue,
					downloadLimitUnit: repository.downloadLimitUnit,
				})),
			),
		),
		volumes: sortConfigRecords(
			await Promise.all(
				volumes.map(async (volume) => ({
					name: volume.name,
					type: volume.type,
					config: await decryptVolumeConfig(volume.config),
					autoRemount: volume.autoRemount,
				})),
			),
		),
		backupSchedules: sortConfigRecords(
			backupSchedules.map((schedule) => ({
				name: schedule.name,
				volumeName: getMappedName(volumeNamesById, schedule.volumeId, "volume"),
				repositoryName: getMappedName(repositoryNamesById, schedule.repositoryId, "repository"),
				enabled: schedule.enabled,
				cronExpression: schedule.cronExpression,
				retentionPolicy: schedule.retentionPolicy,
				excludePatterns: schedule.excludePatterns,
				excludeIfPresent: schedule.excludeIfPresent,
				includePaths: schedule.includePaths,
				includePatterns: schedule.includePatterns,
				oneFileSystem: schedule.oneFileSystem,
				customResticParams: schedule.customResticParams,
				backupWebhooks: schedule.backupWebhooks,
				sortOrder: schedule.sortOrder,
				maxRetries: schedule.maxRetries,
				retryDelay: schedule.retryDelay,
			})),
		),
		notificationDestinations: sortConfigRecords(
			await Promise.all(
				notificationDestinations.map(async (destination) => ({
					name: destination.name,
					enabled: destination.enabled,
					type: destination.type,
					config: await decryptNotificationConfig(destination.config),
				})),
			),
		),
		backupScheduleMirrors: sortConfigRecords(
			backupScheduleMirrors.map((mirror) => ({
				scheduleName: getMappedName(scheduleNamesById, mirror.scheduleId, "backup schedule"),
				repositoryName: getMappedName(repositoryNamesById, mirror.repositoryId, "repository"),
				enabled: mirror.enabled,
			})),
		),
		backupScheduleNotifications: sortConfigRecords(
			backupScheduleNotifications.map((notification) => ({
				scheduleName: getMappedName(scheduleNamesById, notification.scheduleId, "backup schedule"),
				destinationName: getMappedName(destinationNamesById, notification.destinationId, "notification destination"),
				notifyOnStart: notification.notifyOnStart,
				notifyOnSuccess: notification.notifyOnSuccess,
				notifyOnWarning: notification.notifyOnWarning,
				notifyOnFailure: notification.notifyOnFailure,
			})),
		),
	};
};

describe("system security", () => {
	test("should return 401 if no session cookie is provided", async () => {
		const res = await app.request("/api/v1/system/info");
		expect(res.status).toBe(401);
		const body = await res.json();
		expect(body.message).toBe("Invalid or expired session");
	});

	test("should return 401 if session is invalid", async () => {
		const res = await app.request("/api/v1/system/info", {
			headers: getAuthHeaders("invalid-session"),
		});
		expect(res.status).toBe(401);
		const body = await res.json();
		expect(body.message).toBe("Invalid or expired session");
	});

	test("should return 200 if session is valid", async () => {
		const res = await app.request("/api/v1/system/info", {
			headers: session.headers,
		});

		expect(res.status).toBe(200);
	});

	test("returns desktop runtime and effective backend lists in desktop mode", async () => {
		config.runtime = "desktop";
		const desktopAuthSession = await createDesktopTestSession();

		try {
			const res = await app.request("/api/v1/system/info", {
				headers: desktopAuthSession.headers,
			});

			expect(res.status).toBe(200);
			const body = await res.json();
			expect(body).toMatchObject({
				runtime: "desktop",
				capabilities: {
					volumeBackends: ["directory"],
					repositoryBackends: ["local", "s3", "r2", "gcs", "azure", "sftp", "rest"],
				},
			});
		} finally {
			config.runtime = "server";
		}
	});

	describe("unauthenticated access", () => {
		const endpoints: { method: string; path: string }[] = [
			{ method: "GET", path: "/api/v1/system/info" },
			{ method: "GET", path: "/api/v1/system/updates" },
			{ method: "GET", path: "/api/v1/system/registration-status" },
			{ method: "PUT", path: "/api/v1/system/registration-status" },
			{ method: "GET", path: "/api/v1/system/password-login-status" },
			{ method: "PUT", path: "/api/v1/system/password-login-status" },
			{ method: "POST", path: "/api/v1/system/restic-password" },
			{ method: "POST", path: "/api/v1/system/config-export" },
			{ method: "POST", path: "/api/v1/system/config-import" },
			{ method: "GET", path: "/api/v1/system/dev-panel" },
		];

		for (const { method, path } of endpoints) {
			test(`${method} ${path} should return 401`, async () => {
				const res = await app.request(path, { method });
				expect(res.status).toBe(401);
				const body = await res.json();
				expect(body.message).toBe("Invalid or expired session");
			});
		}
	});

	describe("registration-status endpoint", () => {
		test("GET /api/v1/system/registration-status should be accessible with valid session", async () => {
			const res = await app.request("/api/v1/system/registration-status", {
				headers: session.headers,
			});
			expect(res.status).toBe(200);
			const body = await res.json();
			expect(typeof body.enabled).toBe("boolean");
		});

		test("PUT /api/v1/system/registration-status should return 403 for non-admin users", async () => {
			const res = await app.request("/api/v1/system/registration-status", {
				method: "PUT",
				headers: {
					...session.headers,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({ enabled: false }),
			});
			expect(res.status).toBe(403);
			const body = await res.json();
			expect(body.message).toBe("Forbidden");
		});

		test("PUT /api/v1/system/registration-status should be accessible to global admin", async () => {
			const res = await app.request("/api/v1/system/registration-status", {
				method: "PUT",
				headers: {
					...globalAdminSession.headers,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({ enabled: true }),
			});
			expect(res.status).toBe(200);
		});
	});

	describe("password-login-status endpoint", () => {
		test("GET /api/v1/system/password-login-status should be accessible with valid session", async () => {
			await db.delete(appMetadataTable).where(eq(appMetadataTable.key, PASSWORD_LOGIN_DISABLED_KEY));

			const res = await app.request("/api/v1/system/password-login-status", {
				headers: session.headers,
			});
			expect(res.status).toBe(200);
			const body = await res.json();
			expect(typeof body.disabled).toBe("boolean");
			expect(body.disabled).toBe(false);
		});

		test("PUT /api/v1/system/password-login-status should return 403 for non-admin users", async () => {
			const res = await app.request("/api/v1/system/password-login-status", {
				method: "PUT",
				headers: {
					...session.headers,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({ disabled: true }),
			});
			expect(res.status).toBe(403);
			const body = await res.json();
			expect(body.message).toBe("Forbidden");
		});

		test("PUT /api/v1/system/password-login-status should be accessible to global admin", async () => {
			const res = await app.request("/api/v1/system/password-login-status", {
				method: "PUT",
				headers: {
					...globalAdminSession.headers,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({ disabled: false }),
			});
			expect(res.status).toBe(200);
			expect(await res.json()).toEqual({ disabled: false });
		});
	});

	describe("dev-panel endpoint", () => {
		test("GET /api/v1/system/dev-panel should be accessible with valid session", async () => {
			const res = await app.request("/api/v1/system/dev-panel", { headers: session.headers });
			expect(res.status).toBe(200);
			const body = await res.json();
			expect(typeof body.enabled).toBe("boolean");
		});
	});

	describe("updates endpoint", () => {
		test("GET /api/v1/system/updates should be accessible with valid session", async () => {
			const expectedUpdates = {
				currentVersion: "1.0.0",
				latestVersion: "1.0.0",
				hasUpdate: false,
				missedReleases: [],
			};

			vi.spyOn(systemService, "getUpdates").mockResolvedValue({
				...expectedUpdates,
			});

			const res = await app.request("/api/v1/system/updates", { headers: session.headers });
			expect(res.status).toBe(200);
			expect(await res.json()).toEqual(expectedUpdates);
		});
	});

	describe("input validation", () => {
		test("should return complete decrypted restic password content", async () => {
			const { cryptoUtils: actualCryptoUtils } =
				await vi.importActual<typeof import("~/server/utils/crypto")>("~/server/utils/crypto");
			const resticPassword = "correct-restic-passwordb";
			const encryptedResticPassword = await actualCryptoUtils.sealSecret(resticPassword);

			await db
				.update(organization)
				.set({ metadata: { resticPassword: encryptedResticPassword } })
				.where(eq(organization.id, session.organizationId));
			vi.spyOn(authHelpers, "userHasPassword").mockResolvedValueOnce(true);
			vi.spyOn(authHelpers, "verifyUserPassword").mockResolvedValueOnce(true);
			vi.spyOn(cryptoUtils, "resolveSecret").mockImplementationOnce(actualCryptoUtils.resolveSecret);

			const res = await app.request("/api/v1/system/restic-password", {
				method: "POST",
				headers: {
					...session.headers,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					password: "password",
				}),
			});

			expect(res.status).toBe(200);
			expect(res.headers.get("Content-Type")).toContain("text/plain");
			expect(await res.text()).toBe(resticPassword);
		});

		test("should download restic password without password re-authentication for desktop sessions", async () => {
			config.runtime = "desktop";
			const desktopAuthSession = await createDesktopTestSession();
			const { cryptoUtils: actualCryptoUtils } =
				await vi.importActual<typeof import("~/server/utils/crypto")>("~/server/utils/crypto");
			const resticPassword = "desktop-restic-password";
			const encryptedResticPassword = await actualCryptoUtils.sealSecret(resticPassword);
			const verifyPasswordSpy = vi.spyOn(authHelpers, "verifyUserPassword").mockResolvedValueOnce(false);

			await db
				.update(organization)
				.set({ metadata: { resticPassword: encryptedResticPassword } })
				.where(eq(organization.id, desktopAuthSession.organizationId));
			await db
				.update(usersTable)
				.set({ hasDownloadedResticPassword: false })
				.where(eq(usersTable.id, desktopAuthSession.user.id));
			vi.spyOn(cryptoUtils, "resolveSecret").mockImplementationOnce(actualCryptoUtils.resolveSecret);

			const res = await app.request("/api/v1/system/restic-password", {
				method: "POST",
				headers: {
					...desktopAuthSession.headers,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					password: "",
				}),
			});

			expect(res.status).toBe(200);
			expect(await res.text()).toBe(resticPassword);
			expect(verifyPasswordSpy).not.toHaveBeenCalled();

			const updatedUser = await db.query.usersTable.findFirst({
				where: { id: desktopAuthSession.user.id },
			});
			expect(updatedUser?.hasDownloadedResticPassword).toBe(true);
		});

		test("rejects browser sessions in desktop mode", async () => {
			config.runtime = "desktop";
			const browserSession = await createTestSession();
			const verifyPasswordSpy = vi.spyOn(authHelpers, "verifyUserPassword").mockResolvedValueOnce(false);

			const res = await app.request("/api/v1/system/restic-password", {
				method: "POST",
				headers: {
					...browserSession.headers,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					password: "wrong-password",
				}),
			});

			expect(res.status).toBe(401);
			expect(verifyPasswordSpy).not.toHaveBeenCalled();
			const body = await res.json();
			expect(body.message).toBe("Invalid or expired session");
		});

		test("rejects desktop sessions outside desktop mode", async () => {
			const desktopAuthSession = await createDesktopTestSession();
			const verifyPasswordSpy = vi.spyOn(authHelpers, "verifyUserPassword").mockResolvedValueOnce(false);

			const res = await app.request("/api/v1/system/restic-password", {
				method: "POST",
				headers: {
					...desktopAuthSession.headers,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					password: "wrong-password",
				}),
			});

			expect(res.status).toBe(401);
			expect(verifyPasswordSpy).not.toHaveBeenCalled();
			const body = await res.json();
			expect(body.message).toBe("Invalid or expired session");
		});

		test("should return 400 for invalid payload on restic-password", async () => {
			const res = await app.request("/api/v1/system/restic-password", {
				method: "POST",
				headers: {
					...session.headers,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({}),
			});

			expect(res.status).toBe(400);
		});

		test("should return 401 for incorrect password on restic-password", async () => {
			vi.spyOn(authHelpers, "userHasPassword").mockResolvedValueOnce(true);
			vi.spyOn(authHelpers, "verifyUserPassword").mockResolvedValueOnce(false);

			const res = await app.request("/api/v1/system/restic-password", {
				method: "POST",
				headers: {
					...session.headers,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					password: "wrong-password",
				}),
			});

			expect(res.status).toBe(401);
			const body = await res.json();
			expect(body.message).toBe("Invalid password");
		});

		test("should return 400 for invalid payload on config-import", async () => {
			const { headers } = await createTestSession();
			const res = await app.request("/api/v1/system/config-import", {
				method: "POST",
				headers: {
					...headers,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({ encryptedConfig: "" }),
			});

			expect(res.status).toBe(400);
		});
	});

	describe("configuration transfer", () => {
		test("should import released v1 configuration fixture", async () => {
			const encryptedConfig = (
				await readFile(new URL("../__fixtures__/config-transfer/v1-full.zbex", import.meta.url), "utf8")
			).trim();
			const plaintextPayload = JSON.parse(
				await readFile(new URL("../__fixtures__/config-transfer/v1-full.payload.json", import.meta.url), "utf8"),
			);
			const decryptedPayload = JSON.parse(
				await cryptoUtils.decryptWithSecret(encryptedConfig, {
					prefix: "zbcfg:",
					secret: configTransferFixtureSourceAppSecret,
				}),
			);
			const targetSession = await createTestSession();

			expect(decryptedPayload).toEqual(plaintextPayload);

			const importRes = await app.request("/api/v1/system/config-import", {
				method: "POST",
				headers: {
					...targetSession.headers,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					encryptedConfig,
					sourceAppSecret: configTransferFixtureSourceAppSecret,
				}),
			});

			expect(importRes.status).toBe(200);
			expect(await importRes.json()).toEqual({
				message: "Configuration imported successfully",
				imported: {
					repositories: plaintextPayload.repositories.length,
					volumes: plaintextPayload.volumes.length,
					backupSchedules: plaintextPayload.backupSchedules.length,
					notificationDestinations: plaintextPayload.notificationDestinations.length,
					backupScheduleMirrors: plaintextPayload.backupScheduleMirrors.length,
					backupScheduleNotifications: plaintextPayload.backupScheduleNotifications.length,
				},
				warnings: [],
			});

			const normalizedConfig = await loadNormalizedConfigState(targetSession.organizationId);
			expect(normalizedConfig.repositories).toEqual(
				expect.arrayContaining([
					expect.objectContaining({
						name: "Fixture Primary Repository",
						config: expect.objectContaining({ backend: "rclone", customPassword: "fixture-primary-password" }),
						compressionMode: "max",
						uploadLimitEnabled: true,
						uploadLimitValue: 100,
						downloadLimitEnabled: false,
					}),
					expect.objectContaining({
						name: "Fixture Mirror Repository",
						compressionMode: "off",
						downloadLimitEnabled: true,
						downloadLimitValue: 9,
					}),
				]),
			);
			expect(normalizedConfig.volumes).toEqual(
				expect.arrayContaining([
					expect.objectContaining({
						name: "Fixture Volume",
						config: { backend: "rclone", remote: "fixture-volume", path: "/data", readOnly: true },
						autoRemount: false,
					}),
				]),
			);
			expect(normalizedConfig.backupSchedules).toEqual(
				expect.arrayContaining([
					expect.objectContaining({
						name: "Fixture Nightly Backup",
						volumeName: "Fixture Volume",
						repositoryName: "Fixture Primary Repository",
						enabled: true,
						retentionPolicy: { keepLast: 5, keepDaily: 2, keepWithinDuration: "30d" },
						oneFileSystem: true,
						customResticParams: ["--tag", "fixture"],
					}),
				]),
			);
			expect(normalizedConfig.notificationDestinations).toEqual(
				expect.arrayContaining([
					expect.objectContaining({
						name: "Fixture Notification",
						enabled: true,
						type: "generic",
					}),
				]),
			);
			expect(normalizedConfig.backupScheduleMirrors).toEqual([
				{ scheduleName: "Fixture Nightly Backup", repositoryName: "Fixture Mirror Repository", enabled: false },
			]);
			expect(normalizedConfig.backupScheduleNotifications).toEqual([
				{
					scheduleName: "Fixture Nightly Backup",
					destinationName: "Fixture Notification",
					notifyOnStart: true,
					notifyOnSuccess: false,
					notifyOnWarning: true,
					notifyOnFailure: false,
				},
			]);

			const importedRepositories = await db.query.repositoriesTable.findMany({
				where: { organizationId: targetSession.organizationId },
			});
			const importedVolume = await db.query.volumesTable.findFirst({
				where: { organizationId: targetSession.organizationId },
			});
			const importedSchedule = await db.query.backupSchedulesTable.findFirst({
				where: { organizationId: targetSession.organizationId },
			});

			expect(importedRepositories.every((repository) => repository.status === "unknown")).toBe(true);
			expect(importedRepositories.every((repository) => repository.lastChecked === null)).toBe(true);
			expect(importedVolume?.status).toBe("unmounted");
			expect(importedVolume?.lastError).toBeNull();
			expect(importedSchedule?.lastBackupAt).toBeNull();
			expect(importedSchedule?.lastBackupStatus).toBeNull();
			expect(importedSchedule?.lastBackupError).toBeNull();
			expect(importedSchedule?.failureRetryCount).toBe(0);
			expect(importedSchedule?.nextBackupAt).toBeGreaterThan(Date.now());

			const targetOrg = await db.query.organization.findFirst({ where: { id: targetSession.organizationId } });
			expect(targetOrg?.metadata?.resticPassword).toBeDefined();
			expect(await cryptoUtils.resolveSecret(targetOrg?.metadata?.resticPassword ?? "")).toBe("test-restic-password");
		});

		test("should preserve current durable configuration fields on round trip", async () => {
			const sourceSession = await createTestSession();
			await createCompleteDurableConfiguration(sourceSession.organizationId);
			const sourceConfig = await loadNormalizedConfigState(sourceSession.organizationId);

			const exportRes = await app.request("/api/v1/system/config-export", {
				method: "POST",
				headers: sourceSession.headers,
			});

			expect(exportRes.status).toBe(200);
			const encryptedConfig = await exportRes.text();
			const targetSession = await createTestSession();

			const importRes = await app.request("/api/v1/system/config-import", {
				method: "POST",
				headers: {
					...targetSession.headers,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					encryptedConfig,
					sourceAppSecret: config.appSecret,
				}),
			});

			expect(importRes.status).toBe(200);
			expect(await loadNormalizedConfigState(targetSession.organizationId)).toEqual(sourceConfig);
		});

		test("should export and import encrypted organization configuration", async () => {
			const sourceSession = await createTestSession();

			const [sourceVolume] = await db
				.insert(volumesTable)
				.values({
					shortId: generateShortId(),
					name: "Source Volume",
					type: "directory",
					config: { backend: "directory", path: "/tmp/source-volume" },
					status: "mounted",
					lastError: "stale volume error",
					lastHealthCheck: 123,
					autoRemount: true,
					organizationId: sourceSession.organizationId,
				})
				.returning();
			const sealedSourceRepositoryPassword = await cryptoUtils.encryptWithSecret("source-repository-password", {
				prefix: "encv1:",
				secret: config.appSecret,
			});

			const [sourceRepository] = await db
				.insert(repositoriesTable)
				.values({
					id: crypto.randomUUID(),
					shortId: generateShortId(),
					name: "Source Repository",
					type: "local",
					config: {
						backend: "local",
						path: "/tmp/source-repository",
						customPassword: sealedSourceRepositoryPassword,
					},
					compressionMode: "max",
					status: "error",
					lastChecked: 456,
					lastError: "stale repository error",
					uploadLimitEnabled: true,
					uploadLimitValue: 42,
					uploadLimitUnit: "Mbps",
					downloadLimitEnabled: true,
					downloadLimitValue: 21,
					downloadLimitUnit: "Mbps",
					organizationId: sourceSession.organizationId,
				})
				.returning();

			const [mirrorRepository] = await db
				.insert(repositoriesTable)
				.values({
					id: crypto.randomUUID(),
					shortId: generateShortId(),
					name: "Mirror Repository",
					type: "local",
					config: { backend: "local", path: "/tmp/mirror-repository" },
					compressionMode: "off",
					status: "healthy",
					organizationId: sourceSession.organizationId,
				})
				.returning();

			const [sourceSchedule] = await db
				.insert(backupSchedulesTable)
				.values({
					shortId: generateShortId(),
					name: "Source Schedule",
					volumeId: sourceVolume.id,
					repositoryId: sourceRepository.id,
					enabled: true,
					cronExpression: "0 * * * *",
					retentionPolicy: { keepLast: 7 },
					excludePatterns: [".DS_Store"],
					excludeIfPresent: [".nobackup"],
					includePaths: ["/Documents"],
					includePatterns: ["**/*.txt"],
					oneFileSystem: false,
					customResticParams: ["--json"],
					backupWebhooks: { pre: null, post: null },
					lastBackupAt: 789,
					lastBackupStatus: "in_progress",
					lastBackupError: "stale schedule error",
					nextBackupAt: 1,
					sortOrder: 4,
					failureRetryCount: 2,
					maxRetries: 3,
					retryDelay: 15 * 60 * 1000,
					organizationId: sourceSession.organizationId,
				})
				.returning();

			const [sourceDestination] = await db
				.insert(notificationDestinationsTable)
				.values({
					name: "Source Notification",
					enabled: true,
					type: "generic",
					config: {
						type: "generic",
						url: "https://example.com/webhook",
						method: "POST",
					},
					organizationId: sourceSession.organizationId,
				})
				.returning();

			await db.insert(backupScheduleMirrorsTable).values({
				scheduleId: sourceSchedule.id,
				repositoryId: mirrorRepository.id,
				enabled: true,
				lastCopyAt: 999,
				lastCopyStatus: "error",
				lastCopyError: "stale mirror error",
			});

			await db.insert(backupScheduleNotificationsTable).values({
				scheduleId: sourceSchedule.id,
				destinationId: sourceDestination.id,
				notifyOnStart: true,
				notifyOnSuccess: false,
				notifyOnWarning: true,
				notifyOnFailure: false,
			});

			const exportRes = await app.request("/api/v1/system/config-export", {
				method: "POST",
				headers: sourceSession.headers,
			});

			expect(exportRes.status).toBe(200);
			const encryptedConfig = await exportRes.text();
			expect(encryptedConfig.startsWith("zbcfg:")).toBe(true);
			await expect(
				cryptoUtils.decryptWithSecret(encryptedConfig, {
					prefix: "zbcfg:",
					secret: "test-restic-password",
				}),
			).rejects.toThrow();

			const decryptedPayload = JSON.parse(
				await cryptoUtils.decryptWithSecret(encryptedConfig, {
					prefix: "zbcfg:",
					secret: config.appSecret,
				}),
			);

			expect(decryptedPayload.version).toBe(1);
			expect(decryptedPayload.resticPassword).toBe("test-restic-password");

			const exportedRepository = decryptedPayload.repositories.find(
				(repository: { name: string }) => repository.name === "Source Repository",
			);
			expect(exportedRepository).toMatchObject({
				ref: expect.any(String),
				name: "Source Repository",
				compressionMode: "max",
				uploadLimit: { enabled: true, value: 42, unit: "Mbps" },
				downloadLimit: { enabled: true, value: 21, unit: "Mbps" },
			});
			expect(exportedRepository).not.toHaveProperty("id");
			expect(exportedRepository).not.toHaveProperty("shortId");
			expect(exportedRepository).not.toHaveProperty("status");
			expect(exportedRepository.config.customPassword).toBe(sealedSourceRepositoryPassword);
			expect(exportedRepository.config.customPassword).not.toBe("source-repository-password");

			const exportedSchedule = decryptedPayload.backupSchedules.find(
				(schedule: { name: string }) => schedule.name === "Source Schedule",
			);
			expect(exportedSchedule).toMatchObject({
				ref: expect.any(String),
				volumeRef: expect.any(String),
				repositoryRef: expect.any(String),
				retryDelay: 15 * 60 * 1000,
				backupWebhooks: { pre: null, post: null },
				sortOrder: 4,
			});
			expect(exportedSchedule).not.toHaveProperty("id");
			expect(exportedSchedule).not.toHaveProperty("shortId");
			expect(exportedSchedule).not.toHaveProperty("lastBackupStatus");
			expect(exportedSchedule).not.toHaveProperty("nextBackupAt");

			const exportedDestination = decryptedPayload.notificationDestinations.find(
				(destination: { name: string }) => destination.name === "Source Notification",
			);
			expect(exportedDestination).toMatchObject({ ref: expect.any(String), name: "Source Notification" });
			expect(exportedDestination).not.toHaveProperty("id");

			expect(decryptedPayload.backupScheduleNotifications[0]).toMatchObject({
				scheduleRef: expect.any(String),
				destinationRef: expect.any(String),
				notifyOnStart: true,
				notifyOnSuccess: false,
				notifyOnWarning: true,
				notifyOnFailure: false,
			});

			await db
				.delete(backupScheduleNotificationsTable)
				.where(eq(backupScheduleNotificationsTable.scheduleId, sourceSchedule.id));
			await db.delete(backupScheduleMirrorsTable).where(eq(backupScheduleMirrorsTable.scheduleId, sourceSchedule.id));
			await db
				.delete(backupSchedulesTable)
				.where(eq(backupSchedulesTable.organizationId, sourceSession.organizationId));
			await db
				.delete(notificationDestinationsTable)
				.where(eq(notificationDestinationsTable.organizationId, sourceSession.organizationId));
			await db.delete(volumesTable).where(eq(volumesTable.organizationId, sourceSession.organizationId));
			await db.delete(repositoriesTable).where(eq(repositoriesTable.organizationId, sourceSession.organizationId));

			const targetSession = await createTestSession();
			const importRes = await app.request("/api/v1/system/config-import", {
				method: "POST",
				headers: {
					...targetSession.headers,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					encryptedConfig,
					sourceAppSecret: config.appSecret,
				}),
			});
			expect(importRes.status).toBe(200);
			const importBody = await importRes.json();
			expect(importBody.message).toBe("Configuration imported with warnings");
			expect(importBody.warnings).toEqual(
				expect.arrayContaining([
					'Volume "Source Volume" uses local directory path "/tmp/source-volume". Verify this path on this server before using it.',
					'Repository "Source Repository" uses local path "/tmp/source-repository". Verify that this repository exists on this server before using it.',
					'Repository "Mirror Repository" uses local path "/tmp/mirror-repository". Verify that this repository exists on this server before using it.',
					'Disabled schedule "Source Schedule" because it references volume "Source Volume", repository "Source Repository", and repository "Mirror Repository". Re-enable it after validating those imported paths on this server.',
				]),
			);

			const importedRepositories = await db.query.repositoriesTable.findMany({
				where: { organizationId: targetSession.organizationId },
			});
			const importedVolumes = await db.query.volumesTable.findMany({
				where: { organizationId: targetSession.organizationId },
			});
			const importedSchedules = await db.query.backupSchedulesTable.findMany({
				where: { organizationId: targetSession.organizationId },
			});
			const importedDestinations = await db.query.notificationDestinationsTable.findMany({
				where: { organizationId: targetSession.organizationId },
			});
			const importedSourceRepository = importedRepositories.find(
				(repository) => repository.name === "Source Repository",
			);
			const importedMirrorRepository = importedRepositories.find(
				(repository) => repository.name === "Mirror Repository",
			);
			const importedSchedule = importedSchedules[0];
			const importedDestination = importedDestinations[0];
			const importedVolume = importedVolumes[0];

			expect(importedRepositories).toHaveLength(2);
			expect(importedVolumes).toHaveLength(1);
			expect(importedSchedules).toHaveLength(1);
			expect(importedDestinations).toHaveLength(1);
			expect(importedSourceRepository).toBeDefined();
			expect(importedMirrorRepository).toBeDefined();
			expect(importedSchedule).toBeDefined();
			expect(importedDestination).toBeDefined();
			expect(importedVolume).toBeDefined();

			if (
				!importedSourceRepository ||
				!importedMirrorRepository ||
				!importedSchedule ||
				!importedDestination ||
				!importedVolume
			) {
				throw new Error("Expected imported configuration to be present");
			}

			const importedMirrors = await db.query.backupScheduleMirrorsTable.findMany({
				where: { scheduleId: importedSchedule.id },
			});
			const importedScheduleNotifications = await db.query.backupScheduleNotificationsTable.findMany({
				where: { scheduleId: importedSchedule.id },
			});
			const importedMirror = importedMirrors[0];
			const importedNotificationAssignment = importedScheduleNotifications[0];

			expect(importedMirrors).toHaveLength(1);
			expect(importedScheduleNotifications).toHaveLength(1);

			if (!importedMirror || !importedNotificationAssignment) {
				throw new Error("Expected imported schedule assignments to be present");
			}

			expect(importedSourceRepository.id).not.toBe(sourceRepository.id);
			expect(importedSourceRepository.shortId).not.toBe(sourceRepository.shortId);
			expect(importedSourceRepository.compressionMode).toBe("max");
			expect(importedSourceRepository.status).toBe("unknown");
			expect(importedSourceRepository.lastChecked).toBeNull();
			expect(importedSourceRepository.lastError).toBeNull();
			expect(importedSourceRepository.uploadLimitEnabled).toBe(true);
			expect(importedSourceRepository.uploadLimitValue).toBe(42);
			expect(importedSourceRepository.downloadLimitEnabled).toBe(true);
			expect(importedSourceRepository.downloadLimitValue).toBe(21);
			expect(await decryptRepositoryConfig(importedSourceRepository.config)).toMatchObject({
				customPassword: "source-repository-password",
			});

			expect(importedVolume).toMatchObject({
				name: "Source Volume",
				status: "unmounted",
				lastError: null,
				autoRemount: true,
			});

			expect(importedSchedule).toMatchObject({
				name: "Source Schedule",
				volumeId: importedVolume.id,
				repositoryId: importedSourceRepository.id,
				enabled: false,
				retentionPolicy: { keepLast: 7 },
				excludePatterns: [".DS_Store"],
				excludeIfPresent: [".nobackup"],
				includePaths: ["/Documents"],
				includePatterns: ["**/*.txt"],
				customResticParams: ["--json"],
				lastBackupAt: null,
				lastBackupStatus: null,
				lastBackupError: null,
				failureRetryCount: 0,
				maxRetries: 3,
				retryDelay: 15 * 60 * 1000,
				sortOrder: 4,
			});
			expect(importedSchedule.nextBackupAt).not.toBe(sourceSchedule.nextBackupAt);
			expect(importedSchedule.nextBackupAt).toBeGreaterThan(Date.now());

			expect(importedMirror).toMatchObject({
				scheduleId: importedSchedule.id,
				repositoryId: importedMirrorRepository.id,
				enabled: true,
				lastCopyAt: null,
				lastCopyStatus: null,
				lastCopyError: null,
			});

			expect(importedNotificationAssignment).toMatchObject({
				scheduleId: importedSchedule.id,
				destinationId: importedDestination.id,
				notifyOnStart: true,
				notifyOnSuccess: false,
				notifyOnWarning: true,
				notifyOnFailure: false,
			});

			const targetOrg = await db.query.organization.findFirst({ where: { id: targetSession.organizationId } });
			expect(targetOrg?.metadata?.resticPassword).toBeDefined();
			expect(await cryptoUtils.resolveSecret(targetOrg?.metadata?.resticPassword ?? "")).toBe("test-restic-password");

			const targetUser = await db.query.usersTable.findFirst({ where: { id: targetSession.user.id } });
			expect(targetUser?.hasDownloadedResticPassword).toBe(true);
		});

		test("should return 409 when importing after onboarding", async () => {
			const { headers, user } = await createTestSession();

			await db.update(usersTable).set({ hasDownloadedResticPassword: true }).where(eq(usersTable.id, user.id));

			const res = await app.request("/api/v1/system/config-import", {
				method: "POST",
				headers: {
					...headers,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					encryptedConfig: "zbcfgv1:invalid",
					sourceAppSecret: config.appSecret,
				}),
			});

			expect(res.status).toBe(409);
			const body = await res.json();
			expect(body.message).toBe("Configuration import is only available during onboarding");
		});

		test("should return 400 for invalid source APP_SECRET on config-import", async () => {
			const sourceSession = await createTestSession();
			const exportRes = await app.request("/api/v1/system/config-export", {
				method: "POST",
				headers: sourceSession.headers,
			});

			expect(exportRes.status).toBe(200);
			const encryptedConfig = await exportRes.text();

			const targetSession = await createTestSession();
			const importRes = await app.request("/api/v1/system/config-import", {
				method: "POST",
				headers: {
					...targetSession.headers,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					encryptedConfig,
					sourceAppSecret: "wrong-source-app-secret",
				}),
			});

			expect(importRes.status).toBe(400);
			const body = await importRes.json();
			expect(body.message).toBe("Invalid export file or source APP_SECRET");
		});
	});
});
