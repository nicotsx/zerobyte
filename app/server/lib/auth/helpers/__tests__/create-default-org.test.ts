import { beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { db, sqlite } from "~/server/db/db";
import { account, invitation, member, organization, usersTable } from "~/server/db/schema";
import { ensureDefaultOrg } from "../create-default-org";

const CREATE_DEFAULT_ORG_ROLLBACK_TRIGGER = "create_default_org_member_abort";

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

async function createUser(email: string, username: string) {
	const userId = randomId();
	await db.insert(usersTable).values({
		id: userId,
		email,
		name: username,
		username,
	});
	return userId;
}

describe("ensureDefaultOrg", () => {
	beforeEach(async () => {
		dropTrigger(CREATE_DEFAULT_ORG_ROLLBACK_TRIGGER);
		await db.delete(member);
		await db.delete(account);
		await db.delete(invitation);
		await db.delete(organization);
		await db.delete(usersTable);
	});

	test("returns existing membership without creating another workspace", async () => {
		const userId = await createUser("existing-member@example.com", randomSlug("existing-member"));
		const organizationId = randomId();

		await db.insert(organization).values({
			id: organizationId,
			name: "Existing Org",
			slug: randomSlug("existing"),
			createdAt: new Date(),
		});

		await db.insert(member).values({
			id: randomId(),
			userId,
			organizationId,
			role: "owner",
			createdAt: new Date(),
		});

		const membership = await ensureDefaultOrg(userId);

		expect(membership.organizationId).toBe(organizationId);
		expect(membership.role).toBe("owner");

		const memberships = await db.select().from(member).where(eq(member.userId, userId));
		expect(memberships.length).toBe(1);

		const organizations = await db.select().from(organization);
		expect(organizations.length).toBe(1);
	});

	test("creates personal workspace for new users", async () => {
		const userId = await createUser("local-user@example.com", randomSlug("local-user"));

		const membership = await ensureDefaultOrg(userId);

		expect(membership.role).toBe("owner");
		expect(membership.organization.name).toContain("Workspace");
	});

	test("rolls back organization creation when membership insertion fails", async () => {
		const userId = await createUser("rollback-user@example.com", randomSlug("rollback-user"));

		sqlite.exec(`
			CREATE TRIGGER ${CREATE_DEFAULT_ORG_ROLLBACK_TRIGGER}
			BEFORE INSERT ON member
			WHEN NEW.user_id = '${escapeSqlLiteral(userId)}'
			BEGIN
				SELECT RAISE(ABORT, 'forced createDefaultOrg rollback');
			END;
		`);

		try {
			await expect(ensureDefaultOrg(userId)).rejects.toThrow("forced createDefaultOrg rollback");
		} finally {
			dropTrigger(CREATE_DEFAULT_ORG_ROLLBACK_TRIGGER);
		}

		const memberships = await db.select().from(member).where(eq(member.userId, userId));
		const organizations = await db.select().from(organization);

		expect(memberships).toHaveLength(0);
		expect(organizations).toHaveLength(0);
	});
});
