import { eq } from "drizzle-orm";
import { UnauthorizedError } from "http-errors-enhanced";
import type { GenericEndpointContext } from "better-auth";
import { db } from "~/server/db/db";
import { invitation, member, organization, type User } from "~/server/db/schema";
import { cryptoUtils } from "~/server/utils/crypto";
import { APIError } from "better-auth";
import { extractProviderIdFromContext, normalizeEmail } from "../utils/sso-context";
import { logger } from "~/server/utils/logger";
import { authService } from "~/server/modules/auth/auth.service";

export async function findMembershipWithOrganization(userId: string, organizationId?: string) {
	const membership = await db.query.member.findFirst({
		where: organizationId ? { AND: [{ userId }, { organizationId }] } : { userId },
		with: {
			organization: true,
		},
	});

	return membership ?? null;
}

export function buildOrgSlug(email: string) {
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

async function tryCreateInvitedMembership(
	userId: string,
	email: string,
	ssoProviderRecord: Awaited<ReturnType<typeof authService.getSsoProviderById>>,
) {
	if (!ssoProviderRecord) {
		return null;
	}

	logger.debug("Checking for pending invitations for user", { userId, providerId: ssoProviderRecord.providerId });

	const pendingInvitation = await authService.getPendingInvitation(ssoProviderRecord.organizationId, email);

	if (!pendingInvitation) {
		logger.debug("No pending invitation found for user");
		throw new APIError("FORBIDDEN", { message: "SSO sign-in is invite-only for this organization" });
	}

	await db.transaction(async (tx) => {
		tx.insert(member)
			.values({
				id: Bun.randomUUIDv7(),
				userId,
				role: pendingInvitation.role as "member",
				organizationId: pendingInvitation.organizationId,
				createdAt: new Date(),
			})
			.run();

		tx.update(invitation).set({ status: "accepted" }).where(eq(invitation.id, pendingInvitation.id)).run();
	});

	const invitedMembership = await findMembershipWithOrganization(userId, pendingInvitation.organizationId);
	logger.debug("Created organization membership from invitation", {
		userId,
		organizationId: pendingInvitation.organizationId,
	});

	if (!invitedMembership) {
		throw new Error("Failed to create invited organization membership");
	}

	return invitedMembership;
}

async function createDefaultOrganizationMembership(user: User) {
	logger.debug("Creating default organization for user", { userId: user.id });
	const organizationData = await buildDefaultOrganizationData(user);

	await db.transaction(async (tx) => {
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

export async function createUserDefaultOrg(userId: string, ctx: GenericEndpointContext | null) {
	const user = await db.query.usersTable.findFirst({ where: { id: userId } });
	if (!user) {
		throw new UnauthorizedError("User not found");
	}

	const providerId = extractProviderIdFromContext(ctx);
	if (providerId) {
		const ssoProviderRecord = await authService.getSsoProviderById(providerId);

		if (ssoProviderRecord) {
			// If the user is already a member of this SSO org (accepted a past invitation), let them through
			const existingSsoMembership = await findMembershipWithOrganization(user.id, ssoProviderRecord.organizationId);
			if (existingSsoMembership) {
				return existingSsoMembership;
			}

			// Not yet a member of this SSO org, a valid pending invitation is required.
			const invitedMembership = await tryCreateInvitedMembership(userId, normalizeEmail(user.email), ssoProviderRecord);
			if (invitedMembership) {
				return invitedMembership;
			}
		}
	}

	// Non-SSO path: check for any existing membership before creating a personal org.
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
