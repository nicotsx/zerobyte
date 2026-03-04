import { beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "~/server/db/db";
import { account, invitation, member, organization, usersTable } from "~/server/db/schema";
import { ensureDefaultOrg } from "../create-default-org";

function randomId() {
	return Bun.randomUUIDv7();
}

function randomSlug(prefix: string) {
	return `${prefix}-${Math.random().toString(36).slice(2, 8)}`;
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
});
