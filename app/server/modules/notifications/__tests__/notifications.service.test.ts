import { afterEach, describe, expect, test, vi } from "vitest";
import { db } from "~/server/db/db";
import { notificationDestinationsTable } from "~/server/db/schema";
import { withContext } from "~/server/core/request-context";
import { createTestSession } from "~/test/helpers/auth";
import * as shoutrrr from "~/server/utils/shoutrrr";
import { notificationsService } from "../notifications.service";
import { serverEvents } from "~/server/core/events";
import { cryptoUtils } from "~/server/utils/crypto";
import { STORED_SECRET } from "~/server/utils/stored-secret";
import type { NotificationConfig } from "~/schemas/notifications";

afterEach(() => {
	vi.restoreAllMocks();
});

describe("notificationsService.testDestination", () => {
	test("marks the destination as error when delivery fails", async () => {
		const { organizationId, user } = await createTestSession();

		await withContext({ organizationId, userId: user.id }, async () => {
			const destination = await notificationsService.createDestination("Broken webhook", {
				type: "custom",
				shoutrrrUrl: "discord://token@webhookid",
			});

			vi.spyOn(shoutrrr, "sendNotification").mockResolvedValue({ success: false, error: "webhook rejected" });
			const event = new Promise<Parameters<typeof serverEvents.emit>[1]>((resolve) => {
				serverEvents.once("notification:updated", resolve);
			});

			await expect(notificationsService.testDestination(destination.id)).rejects.toThrow("webhook rejected");
			await expect(event).resolves.toEqual(
				expect.objectContaining({
					organizationId,
					notificationId: destination.id,
					notificationName: "Broken webhook",
					status: "error",
				}),
			);

			const updated = await db.query.notificationDestinationsTable.findFirst({
				where: { id: destination.id },
			});

			expect(updated).toEqual(
				expect.objectContaining({
					status: "error",
					lastChecked: expect.any(Number),
					lastError: expect.stringContaining("webhook rejected"),
				}),
			);
		});
	});

	test("marks the destination as healthy when delivery succeeds", async () => {
		const { organizationId, user } = await createTestSession();

		await withContext({ organizationId, userId: user.id }, async () => {
			const [destination] = await db
				.insert(notificationDestinationsTable)
				.values({
					name: "Recovered webhook",
					type: "custom",
					config: { type: "custom", shoutrrrUrl: "discord://token@webhookid" },
					organizationId,
					status: "error",
					lastError: "previous failure",
				})
				.returning();

			vi.spyOn(shoutrrr, "sendNotification").mockResolvedValue({ success: true });

			await expect(notificationsService.testDestination(destination.id)).resolves.toEqual({ success: true });

			const updated = await db.query.notificationDestinationsTable.findFirst({
				where: { id: destination.id },
			});

			expect(updated).toEqual(
				expect.objectContaining({
					status: "healthy",
					lastChecked: expect.any(Number),
					lastError: null,
				}),
			);
		});
	});
});

describe("notificationsService.updateDestination", () => {
	test("updates metadata for an existing encrypted custom destination without revalidating the encrypted URL", async () => {
		const { organizationId, user } = await createTestSession();

		await withContext({ organizationId, userId: user.id }, async () => {
			const resolveSecretSpy = vi
				.spyOn(cryptoUtils, "resolveSecret")
				.mockResolvedValue("discord://token@webhookid");

			const [destination] = await db
				.insert(notificationDestinationsTable)
				.values({
					name: "Custom webhook",
					type: "custom",
					config: { type: "custom", shoutrrrUrl: "encv1:stored-secret" },
					organizationId,
				})
				.returning();

			const updated = await notificationsService.updateDestination(destination.id, { name: "Renamed webhook" });

			expect(updated.name).toBe("Renamed webhook");
			expect(updated.config).toMatchObject({ type: "custom", shoutrrrUrl: STORED_SECRET });
			expect(resolveSecretSpy).not.toHaveBeenCalled();
		});
	});

	test("preserves credentials only for the same notification authority", async () => {
		const { organizationId, user } = await createTestSession();

		await withContext({ organizationId, userId: user.id }, async () => {
			const [destination] = await db
				.insert(notificationDestinationsTable)
				.values({
					name: "Email",
					type: "email",
					config: {
						type: "email",
						smtpHost: "smtp.example.com",
						smtpPort: 465,
						username: "backup",
						password: "encv1:stored-password",
						from: "backup@example.com",
						to: ["admin@example.com"],
						useTLS: true,
					},
					organizationId,
				})
				.returning();

			const presented = await notificationsService.getDestination(destination.id);
			const presentedConfig = presented.config as Extract<NotificationConfig, { type: "email" }>;
			expect(presented.config).toMatchObject({ password: STORED_SECRET });

			await expect(
				notificationsService.updateDestination(destination.id, { config: presentedConfig }),
			).resolves.toMatchObject({ config: { password: STORED_SECRET } });

			await expect(
				notificationsService.updateDestination(destination.id, {
					config: { ...presentedConfig, smtpHost: "other.example.com" },
				}),
			).rejects.toThrow("re-entered");

			await expect(
				notificationsService.updateDestination(destination.id, {
					config: { ...presentedConfig, password: "encv1:other-record" },
				}),
			).rejects.toThrow("plaintext");
		});
	});

	test("updates metadata for an existing destination without requiring webhook allowlist when config is unchanged", async () => {
		const { organizationId, user } = await createTestSession();

		await withContext({ organizationId, userId: user.id }, async () => {
			const existingConfig = {
				type: "generic" as const,
				url: "https://hooks.example.com/backup",
				method: "POST" as const,
			};
			const [destination] = await db
				.insert(notificationDestinationsTable)
				.values({
					name: "Generic webhook",
					type: "generic",
					config: existingConfig,
					organizationId,
				})
				.returning();

			const updated = await notificationsService.updateDestination(destination.id, {
				name: "Renamed webhook",
				config: existingConfig,
			});

			expect(updated.name).toBe("Renamed webhook");
			expect(updated.config).toMatchObject({
				type: "generic",
				url: "https://hooks.example.com/backup",
				method: "POST",
			});
		});
	});
});
