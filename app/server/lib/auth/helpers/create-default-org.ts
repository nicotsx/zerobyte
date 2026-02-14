import { and, eq, gt, inArray } from "drizzle-orm";
import { UnauthorizedError } from "http-errors-enhanced";
import type { GenericEndpointContext } from "@better-auth/core";
import { db } from "~/server/db/db";
import { invitation, member, organization, ssoProvider } from "~/server/db/schema";
import { cryptoUtils } from "~/server/utils/crypto";
import { APIError } from "better-auth";
import { extractProviderIdFromContext, normalizeEmail } from "../utils/sso-context";

async function findMembershipWithOrganization(userId: string, organizationId?: string) {
	if (organizationId) {
		return db.query.member.findFirst({
			where: {
				AND: [{ userId }, { organizationId }],
			},
			with: { organization: true },
		});
	}

	return db.query.member.findFirst({
		where: { userId },
		with: { organization: true },
	});
}

async function findUserById(userId: string) {
	return db.query.usersTable.findFirst({
		where: { id: userId },
	});
}

function buildOrgSlug(email: string) {
	const [emailPrefix] = email.split("@");
	return `${emailPrefix}-${Math.random().toString(36).slice(-4)}`;
}

async function getProviderOrganizationIdsFromContext(ctx: GenericEndpointContext | null) {
	if (!ctx) {
		return [];
	}

	const providerId = extractProviderIdFromContext(ctx);
	if (!providerId) {
		return [];
	}

	const provider = await db
		.select({ organizationId: ssoProvider.organizationId })
		.from(ssoProvider)
		.where(eq(ssoProvider.providerId, providerId))
		.limit(1);

	return provider.map((providerRow) => providerRow.organizationId);
}

type UserRecord = NonNullable<Awaited<ReturnType<typeof findUserById>>>;

async function tryCreateInvitedMembership(userId: string, email: string, ctx: GenericEndpointContext | null) {
	let providerOrganizationIds = await getProviderOrganizationIdsFromContext(ctx);

	if (providerOrganizationIds.length === 0) {
		const linkedAccounts = await db.query.account.findMany({
			where: { userId },
		});

		const linkedSsoProviderIds = linkedAccounts
			.map((linkedAccount) => linkedAccount.providerId)
			.filter((providerId) => providerId !== "credential");

		if (linkedSsoProviderIds.length === 0) {
			return null;
		}

		const linkedSsoProviders = await db
			.select({ organizationId: ssoProvider.organizationId })
			.from(ssoProvider)
			.where(inArray(ssoProvider.providerId, linkedSsoProviderIds));

		if (linkedSsoProviders.length === 0) {
			return null;
		}

		providerOrganizationIds = [...new Set(linkedSsoProviders.map((provider) => provider.organizationId))];
	}

	if (providerOrganizationIds.length === 0) {
		return null;
	}

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
				inArray(invitation.organizationId, providerOrganizationIds),
				gt(invitation.expiresAt, now),
			),
		);

	const matchingInvitation = pendingInvitations.find(
		(invitationCandidate) => normalizeEmail(invitationCandidate.email) === email,
	);

	if (!matchingInvitation) {
		throw new APIError("FORBIDDEN", {
			message: "SSO sign-in is invite-only for this organization",
		});
	}

	db.transaction((tx) => {
		tx.insert(member)
			.values({
				id: Bun.randomUUIDv7(),
				userId,
				role: matchingInvitation.role as "member",
				organizationId: matchingInvitation.organizationId,
				createdAt: new Date(),
			})
			.run();

		tx.update(invitation).set({ status: "accepted" }).where(eq(invitation.id, matchingInvitation.id)).run();
	});

	const invitedMembership = await findMembershipWithOrganization(userId, matchingInvitation.organizationId);

	if (!invitedMembership) {
		throw new Error("Failed to create invited organization membership");
	}

	return invitedMembership;
}

async function createDefaultOrganizationMembership(user: UserRecord) {
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
	const existingMembership = await findMembershipWithOrganization(userId);
	if (existingMembership) {
		return existingMembership;
	}

	const user = await findUserById(userId);
	if (!user) {
		throw new UnauthorizedError("User not found");
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
