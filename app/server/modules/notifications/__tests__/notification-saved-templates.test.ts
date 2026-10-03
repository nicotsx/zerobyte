import { Database } from "bun:sqlite";
import { readFile } from "node:fs/promises";
import { afterEach, expect, test, vi } from "vitest";
import { defaultNotificationTemplates } from "~/lib/notification-templates/catalog";
import { createApp } from "~/server/app";
import { withContext } from "~/server/core/request-context";
import { db } from "~/server/db/db";
import { backupScheduleNotificationsTable } from "~/server/db/schema";
import { createTestSession } from "~/test/helpers/auth";
import { createTestBackupSchedule } from "~/test/helpers/backup";
import { createTestOrganization } from "~/test/helpers/organization";
import * as shoutrrr from "~/server/utils/shoutrrr";
import { notificationsService } from "../notifications.service";

const customTemplates = {
	...defaultNotificationTemplates,
	backup_failure: { title: "Backup problem: {{schedule}}", body: "{{source}} → {{repository}}\n{{error}}" },
	mirror_failure: { title: "Mirror problem: {{mirrorRepository}}", body: "{{schedule}}: {{error}}" },
	test: { title: "Checking {{destination}}", body: "Hello **{{destination}}**" },
};
const destinationConfig = { type: "custom" as const, shoutrrrUrl: "discord://token@webhookid" };

const setup = async () => {
	const session = await createTestSession();
	const context = { organizationId: session.organizationId, userId: session.user.id };
	const destination = await withContext(context, () =>
		notificationsService.createDestination("Alerts", destinationConfig, customTemplates),
	);

	return { session, context, destination };
};

afterEach(() => vi.restoreAllMocks());

test("migration initializes existing destinations and future inserts with complete templates", async () => {
	const sql = await readFile(
		new URL("../../../../drizzle/20261003075029_complete_darkstar/migration.sql", import.meta.url),
		"utf8",
	);
	const sqlite = new Database(":memory:");

	try {
		sqlite.exec(
			"CREATE TABLE notification_destinations_table (id INTEGER PRIMARY KEY); INSERT INTO notification_destinations_table (id) VALUES (1)",
		);
		sqlite.exec(sql);
		sqlite.exec("INSERT INTO notification_destinations_table (id) VALUES (2)");
		const rows = sqlite
			.query<{ templates: string }, []>("SELECT templates FROM notification_destinations_table ORDER BY id")
			.all();

		expect(rows.map((row) => JSON.parse(row.templates))).toEqual([
			defaultNotificationTemplates,
			defaultNotificationTemplates,
		]);
		expect(() =>
			sqlite.exec("INSERT INTO notification_destinations_table (id, templates) VALUES (3, NULL)"),
		).toThrow();
	} finally {
		sqlite.close();
	}
});

test("API exposes saved templates and updates content independently of provider configuration", async () => {
	const { session, destination } = await setup();
	const app = createApp();
	const result = await app.request(`/api/v1/notifications/destinations/${destination.id}`, {
		method: "PATCH",
		headers: { ...session.headers, "Content-Type": "application/json" },
		body: JSON.stringify({ templates: defaultNotificationTemplates }),
	});

	expect(result.status).toBe(200);
	expect(await result.json()).toMatchObject({ templates: defaultNotificationTemplates, config: destination.config });

	const renamed = await app.request(`/api/v1/notifications/destinations/${destination.id}`, {
		method: "PATCH",
		headers: { ...session.headers, "Content-Type": "application/json" },
		body: JSON.stringify({ name: "Renamed" }),
	});

	expect(await renamed.json()).toMatchObject({ name: "Renamed", templates: defaultNotificationTemplates });
});

test("creation initializes defaults while content changes preserve encrypted configuration", async () => {
	const { context, destination } = await setup();

	await withContext(context, async () => {
		const created = await notificationsService.createDestination("Default", destinationConfig);
		expect(created.templates).toEqual(defaultNotificationTemplates);

		const updated = await notificationsService.updateDestination(destination.id, {
			templates: defaultNotificationTemplates,
		});
		expect(updated.config).toEqual(destination.config);
		expect(updated.templates).toEqual(defaultNotificationTemplates);
	});
});

test.each([
	{ title: "{{unknown}}", body: "Content" },
	{ title: "Title", body: "{{#source}}Unclosed" },
	{ title: "Title", body: "x".repeat(16001) },
	{ title: " ", body: "Content" },
])("rejects invalid saved and draft templates without changing content or delivery status", async (template) => {
	const { session, destination } = await setup();
	const app = createApp();
	const headers = { ...session.headers, "Content-Type": "application/json" };
	const send = vi.spyOn(shoutrrr, "sendNotification").mockResolvedValue({ success: true });

	const saved = await app.request(`/api/v1/notifications/destinations/${destination.id}`, {
		method: "PATCH",
		headers,
		body: JSON.stringify({ templates: { ...customTemplates, backup_failure: template } }),
	});
	const draft = await app.request(`/api/v1/notifications/destinations/${destination.id}/test-template`, {
		method: "POST",
		headers,
		body: JSON.stringify({ key: "backup_failure", template }),
	});

	expect(saved.status).toBe(400);
	expect(draft.status).toBe(400);
	expect(send).not.toHaveBeenCalled();
	expect(await db.query.notificationDestinationsTable.findFirst({ where: { id: destination.id } })).toMatchObject({
		templates: customTemplates,
		status: "unknown",
		lastChecked: null,
	});
});

test("sends saved test templates and selected sample drafts through the same provider without persisting drafts", async () => {
	const { session, context, destination } = await setup();
	const send = vi.spyOn(shoutrrr, "sendNotification").mockResolvedValue({ success: true });

	await withContext(context, () => notificationsService.testDestination(destination.id));
	expect(send).toHaveBeenLastCalledWith(expect.objectContaining({ title: "Checking Alerts", body: "Hello Alerts" }));

	const result = await createApp().request(`/api/v1/notifications/destinations/${destination.id}/test-template`, {
		method: "POST",
		headers: { ...session.headers, "Content-Type": "application/json" },
		body: JSON.stringify({
			key: "backup_success",
			template: { title: "{{schedule}}", body: "{{files}} files: **{{repository}}**" },
		}),
	});

	expect(result.status).toBe(200);
	expect(send).toHaveBeenLastCalledWith(
		expect.objectContaining({ title: "Nightly documents", body: "1,250 files: Cloud backup" }),
	);
	expect(await db.query.notificationDestinationsTable.findFirst({ where: { id: destination.id } })).toMatchObject({
		templates: customTemplates,
		status: "healthy",
		lastError: null,
		lastChecked: expect.any(Number),
	});
});

test.each([
	{ scenario: "multiline name", name: "Alpha\r\nBeta" },
	{ scenario: "long Unicode multiline name", name: `Alpha\r\nBeta ${"😀".repeat(100)}` },
])("draft and saved tests deliver identical normalized destination context for $scenario", async ({ name }) => {
	const { session, context, destination } = await setup();
	const app = createApp();
	const headers = { ...session.headers, "Content-Type": "application/json" };
	const path = `/api/v1/notifications/destinations/${destination.id}`;
	const template = { title: "{{destination}}", body: "{{destination}}" };
	const send = vi.spyOn(shoutrrr, "sendNotification").mockResolvedValue({ success: true });

	await withContext(context, () => notificationsService.updateDestination(destination.id, { name }));

	const draft = await app.request(`${path}/test-template`, {
		method: "POST",
		headers,
		body: JSON.stringify({ key: "test", template }),
	});

	expect(draft.status).toBe(200);
	expect(await db.query.notificationDestinationsTable.findFirst({ where: { id: destination.id } })).toMatchObject({
		name,
		templates: customTemplates,
	});

	const saved = await app.request(path, {
		method: "PATCH",
		headers,
		body: JSON.stringify({ templates: { ...customTemplates, test: template } }),
	});
	const normalTest = await app.request(`${path}/test`, { method: "POST", headers });

	expect(saved.status).toBe(200);
	expect(normalTest.status).toBe(200);
	expect(send).toHaveBeenCalledTimes(2);
	expect(send.mock.calls[0]).toEqual(send.mock.calls[1]);
	expect(send.mock.calls[0]?.[0].body).toMatch(/^Alpha Beta/);
	expect(send.mock.calls[0]?.[0].body).not.toMatch(/[\r\n]/);
	expect(Buffer.byteLength(send.mock.calls[0]?.[0].body ?? "", "utf8")).toBeLessThanOrEqual(256);
});

test("draft delivery requires authentication, matching organization, and enabled destination", async () => {
	const { session, context, destination } = await setup();
	const app = createApp();
	const path = `/api/v1/notifications/destinations/${destination.id}/test-template`;
	const body = JSON.stringify({ key: "test", template: customTemplates.test });
	const send = vi.spyOn(shoutrrr, "sendNotification").mockResolvedValue({ success: true });
	const otherSession = await createTestSession();

	expect((await app.request(path, { method: "POST" })).status).toBe(401);
	expect(
		(
			await app.request(path, {
				method: "POST",
				headers: { ...otherSession.headers, "Content-Type": "application/json" },
				body,
			})
		).status,
	).toBe(404);

	await withContext(context, () => notificationsService.updateDestination(destination.id, { enabled: false }));
	expect(
		(
			await app.request(path, {
				method: "POST",
				headers: { ...session.headers, "Content-Type": "application/json" },
				body,
			})
		).status,
	).toBe(409);
	await expect(withContext(context, () => notificationsService.testDestination(destination.id))).rejects.toThrow(
		"Cannot test disabled destination",
	);
	expect(send).not.toHaveBeenCalled();
});

test("backup and mirror delivery use each destination's saved title and body", async () => {
	const organization = await createTestOrganization();
	const schedule = await createTestBackupSchedule({ name: "Nightly" });
	const context = { organizationId: organization.id };
	const destination = await withContext(context, () =>
		notificationsService.createDestination("Alerts", destinationConfig, customTemplates),
	);
	await db
		.insert(backupScheduleNotificationsTable)
		.values({ scheduleId: schedule.id, destinationId: destination.id, notifyOnFailure: true });
	const send = vi.spyOn(shoutrrr, "sendNotification").mockResolvedValue({ success: true });

	await withContext(context, () =>
		notificationsService.sendBackupNotification(schedule.id, "failure", {
			scheduleName: "Nightly",
			volumeName: "Documents",
			repositoryName: "Cloud",
			error: "Cloud connection lost",
		}),
	);
	expect(send).toHaveBeenLastCalledWith(
		expect.objectContaining({ title: "Backup problem: Nightly", body: "Documents → Cloud\nCloud connection lost" }),
	);

	await withContext(context, () =>
		notificationsService.sendMirrorSyncFailureNotification(schedule.id, {
			scheduleName: "Nightly",
			sourceRepositoryName: "Cloud",
			mirrorRepositoryName: "Offsite",
			error: "Cloud connection lost",
		}),
	);
	expect(send).toHaveBeenLastCalledWith(
		expect.objectContaining({ title: "Mirror problem: Offsite", body: "Nightly: Cloud connection lost" }),
	);
});

test("rejects incomplete or nullable sets and preserves existing templates", async () => {
	const { session, destination } = await setup();
	const app = createApp();

	for (const templates of [null, { test: customTemplates.test }]) {
		const response = await app.request(`/api/v1/notifications/destinations/${destination.id}`, {
			method: "PATCH",
			headers: { ...session.headers, "Content-Type": "application/json" },
			body: JSON.stringify({ templates }),
		});

		expect(response.status).toBe(400);
	}

	expect(await db.query.notificationDestinationsTable.findFirst({ where: { id: destination.id } })).toMatchObject({
		templates: customTemplates,
	});
});
