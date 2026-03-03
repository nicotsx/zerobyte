import { beforeEach, describe, expect, test } from "bun:test";
import { db } from "~/server/db/db";
import { member, organization, sessionsTable, usersTable } from "~/server/db/schema";
import { authService } from "../auth.service";

function randomId() {
	return Bun.randomUUIDv7();
}

function randomSlug(prefix: string) {
	return `${prefix}-${Math.random().toString(36).slice(2, 8)}`;
}

async function createUser(email: string) {
	const id = randomId();

	await db.insert(usersTable).values({
		id,
		email,
		name: email.split("@")[0],
		username: randomSlug("user"),
	});

	return id;
}

async function createOrganization(name: string) {
	const id = randomId();

	await db.insert(organization).values({
		id,
		name,
		slug: randomSlug("org"),
		createdAt: new Date(),
	});

	return id;
}

async function createMembership({
	userId,
	organizationId,
	role,
}: {
	userId: string;
	organizationId: string;
	role: "owner" | "admin" | "member";
}) {
	await db.insert(member).values({
		id: randomId(),
		userId,
		organizationId,
		role,
		createdAt: new Date(),
	});
}

async function createSession({
	userId,
	activeOrganizationId,
}: {
	userId: string;
	activeOrganizationId: string | null;
}) {
	const id = randomId();

	await db.insert(sessionsTable).values({
		id,
		userId,
		token: randomSlug("token"),
		expiresAt: new Date(Date.now() + 60_000),
		activeOrganizationId,
	});

	return id;
}

describe("authService.cleanupUserOrganizations", () => {
	beforeEach(async () => {
		await db.delete(member);
		await db.delete(sessionsTable);
		await db.delete(organization);
		await db.delete(usersTable);
	});

	test("reassigns active organization for members whose active org gets deleted", async () => {
		const adminUserId = await createUser(`${randomSlug("admin")}@example.com`);
		const deletedUserId = await createUser(`${randomSlug("deleted")}@example.com`);

		const adminWorkspaceId = await createOrganization("Admin Workspace");
		const deletedWorkspaceId = await createOrganization("Deleted Workspace");

		await createMembership({ userId: adminUserId, organizationId: adminWorkspaceId, role: "owner" });
		await createMembership({ userId: deletedUserId, organizationId: deletedWorkspaceId, role: "owner" });
		await createMembership({ userId: adminUserId, organizationId: deletedWorkspaceId, role: "member" });

		const adminSessionId = await createSession({
			userId: adminUserId,
			activeOrganizationId: deletedWorkspaceId,
		});

		await authService.cleanupUserOrganizations(deletedUserId);

		const remainingSession = await db.query.sessionsTable.findFirst({
			where: { id: adminSessionId },
			columns: { activeOrganizationId: true },
		});
		const deletedWorkspace = await db.query.organization.findFirst({
			where: { id: deletedWorkspaceId },
			columns: { id: true },
		});

		expect(deletedWorkspace).toBeUndefined();
		expect(remainingSession?.activeOrganizationId).toBe(adminWorkspaceId);

		const deletedMembership = await db.query.member.findFirst({
			where: { AND: [{ organizationId: deletedWorkspaceId }, { userId: adminUserId }] },
			columns: { id: true },
		});

		expect(deletedMembership).toBeUndefined();
	});
});
