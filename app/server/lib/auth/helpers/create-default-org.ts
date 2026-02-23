import { eq } from "drizzle-orm";
import { UnauthorizedError } from "http-errors-enhanced";
import type { GenericEndpointContext } from "@better-auth/core";
import { db } from "~/server/db/db";
import { invitation, member, organization, type User } from "~/server/db/schema";
import { cryptoUtils } from "~/server/utils/crypto";
import { APIError } from "better-auth";
import { extractProviderIdFromContext, normalizeEmail } from "../utils/sso-context";
import { logger } from "~/server/utils/logger";

async function findMembershipWithOrganization(userId: string, organizationId?: string) {
	if (organizationId) {
		return db.query.member.findFirst({
			where: { AND: [{ userId }, { organizationId }] },
			with: { organization: true },
		});
	}

	return db.query.member.findFirst({
		where: { userId },
		with: { organization: true },
	});
}

function buildOrgSlug(email: string) {
	const [emailPrefix] = email.split("@");
	return `${emailPrefix}-${Math.random().toString(36).slice(-4)}`;
}

async function getProviderFromContext(ctx: GenericEndpointContext | null) {
	if (!ctx) {
		return null;
	}

	const providerId = extractProviderIdFromContext(ctx);
	if (!providerId) {
		return null;
	}

	const provider = await db.query.ssoProvider.findFirst({ where: { providerId } });
	return provider;
}

async function tryCreateInvitedMembership(userId: string, email: string, ctx: GenericEndpointContext | null) {
	logger.debug("Checking for pending invitations for user", userId, email);

	const ssoProvider = await getProviderFromContext(ctx);
	if (!ssoProvider) {
		logger.debug("No SSO provider found in context, skipping invitation check");
		return null;
	}
	logger.debug("SSO provider found in context, checking for linked accounts", ssoProvider.providerId);

	const now = new Date();

	const pendingInvitation = await db.query.invitation.findFirst({
		where: {
			AND: [
				{ status: "pending" },
				{ organizationId: ssoProvider.organizationId },
				{ expiresAt: { gt: now } },
				{ email: normalizeEmail(email) },
			],
		},
		columns: { id: true, email: true, role: true, organizationId: true },
	});

	if (!pendingInvitation) {
		logger.debug("No pending invitation found for user", { email });
		throw new APIError("FORBIDDEN", { message: "SSO sign-in is invite-only for this organization" });
	}

	db.transaction((tx) => {
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
	const resticPassword = cryptoUtils.generateResticPassword();
	const metadata = { resticPassword: await cryptoUtils.sealSecret(resticPassword) };

	db.transaction((tx) => {
		const orgId = Bun.randomUUIDv7();
		const slug = buildOrgSlug(user.email);

		tx.insert(organization)
			.values({
				name: `${user.name}'s Workspace`,
				slug,
				id: orgId,
				createdAt: new Date(),
				metadata,
			})
			.run();

		tx.insert(member)
			.values({
				id: Bun.randomUUIDv7(),
				userId: user.id,
				role: "owner",
				organizationId: orgId,
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

	const existingMembership = await findMembershipWithOrganization(user.id);
	if (existingMembership) {
		logger.debug("User already has an organization membership, skipping default org creation", { userId });
		return existingMembership;
	}

	const invitedMembership = await tryCreateInvitedMembership(userId, normalizeEmail(user.email), ctx);
	if (invitedMembership) {
		return invitedMembership;
	}

	await createDefaultOrganizationMembership(user);

	const newMembership = await findMembershipWithOrganization(userId);
	if (!newMembership) {
		throw new Error("Failed to create default organization");
	}

	return newMembership;
}
