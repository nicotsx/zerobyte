import { eq } from "drizzle-orm";
import { expect, test } from "vitest";
import { createApp } from "~/server/app";
import { db } from "~/server/db/db";
import { agentsTable } from "~/server/db/schema";
import { createTestSession } from "~/test/helpers/auth";
import { createTestBackupSchedule } from "~/test/helpers/backup";
import { createTrustedFilesystemSource } from "./trusted-filesystem-source.fixture";

const app = createApp();

test("source and schedule responses carry safe location labels while the machine is offline", async () => {
	const session = await createTestSession();
	const { volume, agentId } = await createTrustedFilesystemSource(session.organizationId, "offline");
	await db
		.update(agentsTable)
		.set({
			capabilities: { trustedRoots: [{ id: "photos", label: "/srv/private", canBackup: true }] },
		})
		.where(eq(agentsTable.id, agentId));
	const schedule = await createTestBackupSchedule({ organizationId: session.organizationId, volumeId: volume.id });
	const expectedLocation = { machine: "NAS agent", location: "Allowed location", path: "Allowed location/family" };

	const sourcesResponse = await app.request("/api/v1/volumes", { headers: session.headers });
	expect(sourcesResponse.status).toBe(200);
	const sources = await sourcesResponse.json();
	expect(sources.find((source: { shortId: string }) => source.shortId === volume.shortId).sourceLocation).toEqual(
		expectedLocation,
	);

	for (const url of [`/api/v1/backups/${schedule.shortId}`, `/api/v1/backups/volume/${volume.shortId}`]) {
		const response = await app.request(url, { headers: session.headers });
		expect(response.status).toBe(200);
		const body = await response.json();
		expect(body.volume.sourceLocation).toEqual(expectedLocation);
		expect(JSON.stringify(body)).not.toContain("/srv/private");
		expect(body.volume).not.toHaveProperty("organizationId");
	}

	const schedulesResponse = await app.request("/api/v1/backups", { headers: session.headers });
	expect(schedulesResponse.status).toBe(200);
	const schedules = await schedulesResponse.json();
	expect(
		schedules.find((item: { shortId: string }) => item.shortId === schedule.shortId).volume.sourceLocation,
	).toEqual(expectedLocation);
});

test("source presentation never resolves labels from a machine in another organization", async () => {
	const session = await createTestSession();
	const otherSession = await createTestSession();
	const { volume, agentId } = await createTrustedFilesystemSource(session.organizationId);
	await db
		.update(agentsTable)
		.set({ organizationId: otherSession.organizationId, name: "Private machine" })
		.where(eq(agentsTable.id, agentId));

	const response = await app.request(`/api/v1/volumes/${volume.shortId}`, { headers: session.headers });
	expect(response.status).toBe(200);
	const body = await response.json();
	expect(body.volume.sourceLocation).toEqual({
		machine: "Unknown machine",
		location: "photos",
		path: "photos/family",
	});
	expect(JSON.stringify(body)).not.toContain("Private machine");
});
