import { auth } from "~/server/lib/auth";
import { db } from "~/server/db/db";
import { member, organization, sessionsTable, usersTable } from "~/server/db/schema";
import { eq } from "drizzle-orm";

const COOKIE_PREFIX = "zerobyte";

export function getAuthHeaders(token: string): { Cookie: string } {
	return {
		Cookie: `${COOKIE_PREFIX}.session_token=${token}`,
	};
}

export async function createTestSession() {
	const ctx = await auth.$context;
	const user = ctx.test.createUser();
	await ctx.test.saveUser(user);

	const allUsers = await db.query.usersTable.findMany();
	if (allUsers.length === 1 && allUsers[0].role === "admin") {
		await db.update(usersTable).set({ role: "user" }).where(eq(usersTable.id, user.id));
	}

	const { headers, session } = await ctx.test.login({ userId: user.id });

	const organizationId = (session as { activeOrganizationId?: string }).activeOrganizationId ?? "";

	return {
		headers: Object.fromEntries(headers.entries()) as Record<string, string>,
		session,
		user: { ...user, role: "user" },
		organizationId,
	};
}

export async function createTestSessionWithOrgAdmin() {
	const { headers, user, organizationId } = await createTestSession();

	await db.update(member).set({ role: "admin" }).where(eq(member.userId, user.id));

	return { headers, user, organizationId };
}

export async function createTestSessionWithGlobalAdmin() {
	const ctx = await auth.$context;
	const user = ctx.test.createUser();
	await ctx.test.saveUser(user);

	await db.update(usersTable).set({ role: "admin" }).where(eq(usersTable.id, user.id));

	const [org] = await db
		.insert(organization)
		.values({ id: crypto.randomUUID(), name: "Admin Org", slug: `admin-org-${Date.now()}`, createdAt: new Date() })
		.returning();

	await db.insert(member).values({
		id: crypto.randomUUID(),
		organizationId: org.id,
		userId: user.id,
		role: "owner",
		createdAt: new Date(),
	});

	await db.update(sessionsTable).set({ activeOrganizationId: org.id }).where(eq(sessionsTable.userId, user.id));

	const { headers, session } = await ctx.test.login({ userId: user.id });

	return {
		headers: Object.fromEntries(headers.entries()) as Record<string, string>,
		session,
		user,
		organizationId: org.id,
	};
}

export async function createTestSessionWithRegularMember() {
	const { headers, user, organizationId } = await createTestSession();

	await db.update(member).set({ role: "member" }).where(eq(member.userId, user.id));

	return { headers, user, organizationId };
}
