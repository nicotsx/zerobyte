import { UnauthorizedError } from "http-errors-enhanced";
import { db } from "~/server/db/db";
import { member, organization, type User } from "~/server/db/schema";
import { cryptoUtils } from "~/server/utils/crypto";
import { logger } from "@zerobyte/core/node";

export async function findMembershipWithOrganization(userId: string, organizationId?: string) {
	const membership = await db.query.member.findFirst({
		where: organizationId ? { AND: [{ userId }, { organizationId }] } : { userId },
		with: {
			organization: true,
		},
	});

	return membership ?? null;
}

function buildOrgSlug(email: string) {
	const [emailPrefix] = email.split("@");
	const sanitized = emailPrefix
		.toLowerCase()
		.replace(/[^a-z0-9-]+/g, "-")
		.replace(/-+/g, "-")
		.replace(/^-+|-+$/g, "");
	const safePrefix = sanitized || "org";
	return `${safePrefix}-${Math.random().toString(36).slice(-4)}`;
}

export type DefaultOrganizationData = {
	id: string;
	name: string;
	slug: string;
	createdAt: Date;
	metadata: {
		resticPassword: string;
	};
};

export async function buildDefaultOrganizationData(
	user: Pick<User, "name" | "email">,
	organizationId = Bun.randomUUIDv7(),
): Promise<DefaultOrganizationData> {
	const resticPassword = cryptoUtils.generateResticPassword();

	return {
		id: organizationId,
		name: `${user.name}'s Workspace`,
		slug: buildOrgSlug(user.email),
		createdAt: new Date(),
		metadata: {
			resticPassword: await cryptoUtils.sealSecret(resticPassword),
		},
	};
}

async function createDefaultOrganizationMembership(user: User) {
	logger.debug("Creating default organization for user", { userId: user.id });
	const organizationData = await buildDefaultOrganizationData(user);

	db.transaction((tx) => {
		tx.insert(organization).values(organizationData).run();

		tx.insert(member)
			.values({
				id: Bun.randomUUIDv7(),
				userId: user.id,
				role: "owner",
				organizationId: organizationData.id,
				createdAt: new Date(),
			})
			.run();
	});
}

export async function ensureDefaultOrg(userId: string) {
	const user = await db.query.usersTable.findFirst({ where: { id: userId } });
	if (!user) {
		throw new UnauthorizedError("User not found");
	}

	const existingMembership = await findMembershipWithOrganization(user.id);
	if (existingMembership) {
		logger.debug("User already has an organization membership, skipping default org creation", { userId });
		return existingMembership;
	}

	await createDefaultOrganizationMembership(user);

	const newMembership = await findMembershipWithOrganization(userId);
	if (!newMembership) {
		throw new Error("Failed to create default organization");
	}

	return newMembership;
}
