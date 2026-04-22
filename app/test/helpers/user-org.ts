import { db, sqlite } from "~/server/db/db";
import { member, organization, sessionsTable, usersTable } from "~/server/db/schema";

type MembershipRole = "owner" | "admin" | "member";

export function randomId() {
	return Bun.randomUUIDv7();
}

export function randomSlug(prefix: string) {
	return `${prefix}-${Math.random().toString(36).slice(2, 8)}`;
}

export function escapeSqlLiteral(value: string) {
	return value.replaceAll("'", "''");
}

export function dropTrigger(name: string) {
	sqlite.exec(`DROP TRIGGER IF EXISTS ${name};`);
}

export async function createUser(email: string) {
	const id = randomId();

	await db.insert(usersTable).values({
		id,
		email,
		name: email.split("@")[0],
		username: randomSlug("user"),
	});

	return id;
}

export async function createOrganization(name: string) {
	const id = randomId();

	await db.insert(organization).values({
		id,
		name,
		slug: randomSlug("org"),
		createdAt: new Date(),
	});

	return id;
}

export async function createMembership({
	userId,
	organizationId,
	role,
}: {
	userId: string;
	organizationId: string;
	role: MembershipRole;
}) {
	const id = randomId();

	await db.insert(member).values({
		id,
		userId,
		organizationId,
		role,
		createdAt: new Date(),
	});

	return id;
}

export async function createSession({
	userId,
	activeOrganizationId = null,
}: {
	userId: string;
	activeOrganizationId?: string | null;
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
