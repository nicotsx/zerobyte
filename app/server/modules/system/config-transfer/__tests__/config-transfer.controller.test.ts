import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { config } from "~/server/core/config";
import { db } from "~/server/db/db";
import { organization, usersTable } from "~/server/db/schema";
import * as authHelpers from "~/server/modules/auth/helpers";
import { cryptoUtils } from "~/server/utils/crypto";
import { createTestSession } from "~/test/helpers/auth";
import { eq } from "drizzle-orm";
import { decryptConfigTransferPayload } from "../envelope";
import { parseConfigTransferPayload } from "../payload";
import {
	allowConfigExportPassword,
	configTransferFixturePassphrase,
	createCompleteDurableConfiguration,
	requestConfigExport,
} from "./config-transfer-test-helpers";

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
	test("requires password re-authentication", async () => {
		const sourceSession = await createTestSession();
		vi.spyOn(authHelpers, "userHasPassword").mockResolvedValueOnce(true);
		vi.spyOn(authHelpers, "verifyUserPassword").mockResolvedValueOnce(false);

		const response = await requestConfigExport(sourceSession.headers, "wrong-password");

		expect(response.status).toBe(401);
		expect(await response.json()).toEqual({ message: "Invalid password" });
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
		expect(payload.repositories).toHaveLength(2);
		expect(payload.volumes).toHaveLength(1);
		expect(payload.backupSchedules).toHaveLength(1);
		expect(payload.notificationDestinations).toHaveLength(1);
		expect(payload.backupScheduleMirrors).toHaveLength(1);
		expect(payload.backupScheduleNotifications).toHaveLength(1);
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
