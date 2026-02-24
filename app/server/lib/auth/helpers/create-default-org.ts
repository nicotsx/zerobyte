import { and, eq, gt } from "drizzle-orm";
import { UnauthorizedError } from "http-errors-enhanced";
import type { GenericEndpointContext } from "@better-auth/core";
import { db } from "~/server/db/db";
import { invitation, member, organization, ssoProvider, usersTable, type User } from "~/server/db/schema";
import { cryptoUtils } from "~/server/utils/crypto";
import { APIError } from "better-auth";
import { extractProviderIdFromContext, normalizeEmail } from "../utils/sso-context";
import { logger } from "~/server/utils/logger";

export async function findMembershipWithOrganization(userId: string, organizationId?: string) {
	const memberships = await db
		.select()
		.from(member)
		.where(
			organizationId
				? and(eq(member.userId, userId), eq(member.organizationId, organizationId))
				: eq(member.userId, userId),
		)
		.limit(1);

	const membership = memberships[0];

	if (!membership) {
		return null;
	}

	const orgs = await db.select().from(organization).where(eq(organization.id, membership.organizationId)).limit(1);
	const org = orgs[0];

	if (!org) {
		return null;
	}

	return { ...membership, organization: org };
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

async function tryCreateInvitedMembership(userId: string, email: string, ctx: GenericEndpointContext | null) {
	logger.debug("Checking for pending invitations for user", userId);

	const providerId = extractProviderIdFromContext(ctx);
	const ssoProviders = await db.select().from(ssoProvider).where(eq(ssoProvider.providerId, providerId)).limit(1);
	const ssoProviderRecord = ssoProviders[0];

	if (!ssoProviderRecord) {
		logger.debug("No SSO provider found in context, skipping invitation check");
		return null;
	}
	logger.debug("SSO provider found in context, checking for linked accounts", ssoProviderRecord.providerId);

	const now = new Date();

	const pendingInvitations = await db
		.select({
			id: invitation.id,
			email: invitation.email,
			role: invitation.role,
			organizationId: invitation.organizationId,
		})
		.from(invitation)
		.where(
			and(
				eq(invitation.status, "pending"),
				eq(invitation.organizationId, ssoProviderRecord.organizationId),
				gt(invitation.expiresAt, now),
				eq(invitation.email, normalizeEmail(email)),
			),
		)
		.limit(1);
	const pendingInvitation = pendingInvitations[0];

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
	const resticPassword = cryptoUtils.generateResticPassword();
	const metadata = { resticPassword: await cryptoUtils.sealSecret(resticPassword) };

	await db.transaction(async (tx) => {
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
	const users = await db.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);
	const user = users[0];
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
