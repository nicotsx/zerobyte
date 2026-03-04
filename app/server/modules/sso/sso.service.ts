import { db } from "~/server/db/db";
import { ssoProvider, account, invitation, organization } from "~/server/db/schema";
import { eq, and } from "drizzle-orm";
import { isReservedSsoProviderId } from "./utils/sso-provider-id";
import { normalizeEmail } from "./utils/sso-context";

export class SsoService {
	/**
	 * Get public SSO providers for the instance
	 */
	async getPublicSsoProviders() {
		const providers = await db
			.select({
				providerId: ssoProvider.providerId,
				organizationSlug: organization.slug,
			})
			.from(ssoProvider)
			.innerJoin(organization, eq(ssoProvider.organizationId, organization.id));

		return { providers };
	}

	/**
	 * Get an SSO provider by provider id
	 */
	async getSsoProviderById(providerId: string) {
		return db.query.ssoProvider.findFirst({
			where: { providerId },
			columns: { id: true, providerId: true, organizationId: true },
		});
	}

	/**
	 * Get an active pending invitation for organization/email
	 */
	async getPendingInvitation(organizationId: string, email: string) {
		return db.query.invitation.findFirst({
			where: {
				AND: [
					{ organizationId },
					{ status: "pending" },
					{ expiresAt: { gt: new Date() } },
					{ email: normalizeEmail(email) },
				],
			},
			columns: {
				id: true,
				email: true,
				role: true,
				organizationId: true,
			},
		});
	}

	/**
	 * Get trusted provider ids for organization auto-linking
	 */
	async getAutoLinkingSsoProviderIds(organizationId: string) {
		const providers = await db.query.ssoProvider.findMany({
			columns: { providerId: true },
			where: { organizationId, autoLinkMatchingEmails: true },
		});

		return providers.map((provider) => provider.providerId);
	}

	/**
	 * Delete an SSO provider and its associated accounts
	 */
	async deleteSsoProvider(providerId: string, organizationId: string) {
		return db.transaction(async (tx) => {
			const provider = await tx.query.ssoProvider.findFirst({
				where: { AND: [{ providerId }, { organizationId }] },
				columns: { id: true, providerId: true },
			});

			if (!provider) {
				return false;
			}

			if (isReservedSsoProviderId(provider.providerId)) {
				await tx.delete(ssoProvider).where(eq(ssoProvider.id, provider.id));
				return true;
			}

			await tx.delete(account).where(eq(account.providerId, provider.providerId));
			await tx.delete(ssoProvider).where(eq(ssoProvider.id, provider.id));

			return true;
		});
	}

	/**
	 * Get per-provider auto-linking setting for an organization
	 */
	async getSsoProviderAutoLinkingSettings(organizationId: string) {
		const providers = await db.query.ssoProvider.findMany({
			columns: { providerId: true, autoLinkMatchingEmails: true },
			where: { organizationId },
		});

		return Object.fromEntries(providers.map((provider) => [provider.providerId, provider.autoLinkMatchingEmails]));
	}

	/**
	 * Update per-provider auto-linking setting
	 */
	async updateSsoProviderAutoLinking(providerId: string, organizationId: string, enabled: boolean) {
		const result = await db
			.update(ssoProvider)
			.set({ autoLinkMatchingEmails: enabled })
			.where(and(eq(ssoProvider.providerId, providerId), eq(ssoProvider.organizationId, organizationId)))
			.returning();

		return result.length > 0;
	}

	/**
	 * Get an SSO invitation by ID
	 */
	async getSsoInvitationById(invitationId: string) {
		return db.query.invitation.findFirst({
			where: { id: invitationId },
			columns: { id: true, organizationId: true },
		});
	}

	/**
	 * Delete an invitation
	 */
	async deleteSsoInvitation(invitationId: string) {
		await db.delete(invitation).where(eq(invitation.id, invitationId));
	}
}

export const ssoService = new SsoService();
