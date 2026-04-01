import { beforeEach, describe, expect, test } from "vitest";
import { db, sqlite } from "~/server/db/db";
import { member, organization, sessionsTable, usersTable } from "~/server/db/schema";
import { authService } from "../auth.service";

const CLEANUP_USER_ORGS_ROLLBACK_TRIGGER = "cleanup_user_orgs_final_session_abort";

function randomId() {
	return Bun.randomUUIDv7();
}

function randomSlug(prefix: string) {
	return `${prefix}-${Math.random().toString(36).slice(2, 8)}`;
}

function escapeSqlLiteral(value: string) {
	return value.replaceAll("'", "''");
}

function dropTrigger(name: string) {
	sqlite.exec(`DROP TRIGGER IF EXISTS ${name};`);
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
		dropTrigger(CLEANUP_USER_ORGS_ROLLBACK_TRIGGER);
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

	test("sets active organization to null when user has no other memberships", async () => {
		const deletedOnlyUserId = await createUser(`${randomSlug("deleted")}@example.com`);

		const deletedWorkspaceId = await createOrganization("Deleted Workspace");

		await createMembership({
			userId: deletedOnlyUserId,
			organizationId: deletedWorkspaceId,
			role: "owner",
		});

		const userSessionId = await createSession({
			userId: deletedOnlyUserId,
			activeOrganizationId: deletedWorkspaceId,
		});

		await authService.cleanupUserOrganizations(deletedOnlyUserId);

		const deletedWorkspace = await db.query.organization.findFirst({
			where: { id: deletedWorkspaceId },
			columns: { id: true },
		});
		const updatedSession = await db.query.sessionsTable.findFirst({
			where: { id: userSessionId },
			columns: { activeOrganizationId: true },
		});

		expect(deletedWorkspace).toBeUndefined();
		expect(updatedSession?.activeOrganizationId).toBeNull();

		const membership = await db.query.member.findFirst({
			where: { userId: deletedOnlyUserId },
			columns: { id: true },
		});

		expect(membership).toBeUndefined();
	});

	test("sets active organization to null for affected members without a fallback organization", async () => {
		const deletedUserId = await createUser(`${randomSlug("deleted")}@example.com`);
		const affectedUserId = await createUser(`${randomSlug("affected")}@example.com`);
		const deletedWorkspaceId = await createOrganization("Deleted Workspace");

		await createMembership({ userId: deletedUserId, organizationId: deletedWorkspaceId, role: "owner" });
		await createMembership({ userId: affectedUserId, organizationId: deletedWorkspaceId, role: "member" });

		const affectedSessionId = await createSession({
			userId: affectedUserId,
			activeOrganizationId: deletedWorkspaceId,
		});

		await authService.cleanupUserOrganizations(deletedUserId);

		const updatedSession = await db.query.sessionsTable.findFirst({
			where: { id: affectedSessionId },
			columns: { activeOrganizationId: true },
		});
		const deletedWorkspace = await db.query.organization.findFirst({
			where: { id: deletedWorkspaceId },
			columns: { id: true },
		});
		const removedMembership = await db.query.member.findFirst({
			where: { AND: [{ organizationId: deletedWorkspaceId }, { userId: affectedUserId }] },
			columns: { id: true },
		});

		expect(deletedWorkspace).toBeUndefined();
		expect(updatedSession?.activeOrganizationId).toBeNull();
		expect(removedMembership).toBeUndefined();
	});

	test("rolls back organization cleanup when session nulling fails", async () => {
		const affectedUserId = await createUser(`${randomSlug("admin")}@example.com`);
		const deletedUserId = await createUser(`${randomSlug("deleted")}@example.com`);

		const fallbackWorkspaceId = await createOrganization("Fallback Workspace");
		const deletedWorkspaceId = await createOrganization("Deleted Workspace");

		await createMembership({ userId: affectedUserId, organizationId: fallbackWorkspaceId, role: "owner" });
		await createMembership({ userId: deletedUserId, organizationId: deletedWorkspaceId, role: "owner" });
		await createMembership({ userId: affectedUserId, organizationId: deletedWorkspaceId, role: "member" });

		const affectedSessionId = await createSession({
			userId: affectedUserId,
			activeOrganizationId: deletedWorkspaceId,
		});
		const deletedUserSessionId = await createSession({
			userId: deletedUserId,
			activeOrganizationId: deletedWorkspaceId,
		});

		sqlite.exec(`
			CREATE TRIGGER ${CLEANUP_USER_ORGS_ROLLBACK_TRIGGER}
			BEFORE UPDATE OF active_organization_id ON sessions_table
			WHEN OLD.user_id = '${escapeSqlLiteral(deletedUserId)}' AND NEW.active_organization_id IS NULL
			BEGIN
				SELECT RAISE(ABORT, 'forced cleanup rollback');
			END;
		`);

		try {
			await expect(authService.cleanupUserOrganizations(deletedUserId)).rejects.toThrow("forced cleanup rollback");
		} finally {
			dropTrigger(CLEANUP_USER_ORGS_ROLLBACK_TRIGGER);
		}

		const deletedWorkspace = await db.query.organization.findFirst({
			where: { id: deletedWorkspaceId },
			columns: { id: true },
		});
		const affectedSession = await db.query.sessionsTable.findFirst({
			where: { id: affectedSessionId },
			columns: { activeOrganizationId: true },
		});
		const deletedUserSession = await db.query.sessionsTable.findFirst({
			where: { id: deletedUserSessionId },
			columns: { activeOrganizationId: true },
		});
		const affectedMembership = await db.query.member.findFirst({
			where: { AND: [{ organizationId: deletedWorkspaceId }, { userId: affectedUserId }] },
			columns: { id: true },
		});

		expect(deletedWorkspace).toEqual({ id: deletedWorkspaceId });
		expect(affectedSession?.activeOrganizationId).toBe(deletedWorkspaceId);
		expect(deletedUserSession?.activeOrganizationId).toBe(deletedWorkspaceId);
		expect(affectedMembership).not.toBeUndefined();
	});
});
