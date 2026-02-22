import { db } from "../../db/db";
import {
	usersTable,
	member,
	organization,
	volumesTable,
	repositoriesTable,
	backupSchedulesTable,
	ssoProvider,
	account,
	invitation,
} from "../../db/schema";
import { eq, ne, and, count, inArray } from "drizzle-orm";
import type { PublicSsoProvidersDto, UserDeletionImpactDto } from "./auth.dto";

export class AuthService {
	/**
	 * Check if any users exist in the system
	 */
	async hasUsers(): Promise<boolean> {
		const [user] = await db.select({ id: usersTable.id }).from(usersTable).limit(1);
		return !!user;
	}

	/**
	 * Get public SSO providers for the instance
	 */
	async getPublicSsoProviders(): Promise<PublicSsoProvidersDto> {
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
	 * Get the impact of deleting a user
	 */
	async getUserDeletionImpact(userId: string): Promise<UserDeletionImpactDto> {
		const userMemberships = await db.query.member.findMany({
			where: {
				AND: [{ userId: userId }, { role: "owner" }],
			},
		});

		const impacts: UserDeletionImpactDto["organizations"] = [];

		for (const membership of userMemberships) {
			const otherOwners = await db
				.select({ count: count() })
				.from(member)
				.where(
					and(
						eq(member.organizationId, membership.organizationId),
						eq(member.role, "owner"),
						ne(member.userId, userId),
					),
				);

			if (otherOwners[0].count === 0) {
				const org = await db.query.organization.findFirst({
					where: { id: membership.organizationId },
				});

				if (org) {
					const [volumes, repos, schedules] = await Promise.all([
						db.select({ count: count() }).from(volumesTable).where(eq(volumesTable.organizationId, org.id)),
						db.select({ count: count() }).from(repositoriesTable).where(eq(repositoriesTable.organizationId, org.id)),
						db
							.select({ count: count() })
							.from(backupSchedulesTable)
							.where(eq(backupSchedulesTable.organizationId, org.id)),
					]);

					impacts.push({
						id: org.id,
						name: org.name,
						resources: {
							volumesCount: volumes[0].count,
							repositoriesCount: repos[0].count,
							backupSchedulesCount: schedules[0].count,
						},
					});
				}
			}
		}

		return { organizations: impacts };
	}

	/**
	 * Cleanup organizations where the user was the sole owner
	 */
	async cleanupUserOrganizations(userId: string): Promise<void> {
		const impact = await this.getUserDeletionImpact(userId);
		const orgIds = impact.organizations.map((o) => o.id);

		if (orgIds.length > 0) {
			await db.delete(organization).where(inArray(organization.id, orgIds));
		}
	}

	/**
	 * Delete an SSO provider and its associated accounts
	 */
	async deleteSsoProvider(providerId: string): Promise<void> {
		await db.transaction(async (tx) => {
			await tx.delete(account).where(eq(account.providerId, providerId));
			await tx.delete(ssoProvider).where(eq(ssoProvider.providerId, providerId));
		});
	}

	/**
	 * Get per-provider auto-linking setting for an organization
	 */
	async getSsoProviderAutoLinkingSettings(organizationId: string): Promise<Record<string, boolean>> {
		const providers = await db.query.ssoProvider.findMany({
			columns: { providerId: true, autoLinkMatchingEmails: true },
			where: { organizationId },
		});

		return Object.fromEntries(providers.map((provider) => [provider.providerId, provider.autoLinkMatchingEmails]));
	}

	/**
	 * Update per-provider auto-linking setting
	 */
	async updateSsoProviderAutoLinking(providerId: string, enabled: boolean): Promise<boolean> {
		const existingProvider = await db
			.select({ id: ssoProvider.id })
			.from(ssoProvider)
			.where(eq(ssoProvider.providerId, providerId))
			.limit(1)
			.then((result) => result[0]);

		if (!existingProvider) {
			return false;
		}

		await db.update(ssoProvider).set({ autoLinkMatchingEmails: enabled }).where(eq(ssoProvider.providerId, providerId));

		return true;
	}

	/**
	 * Delete an invitation
	 */
	async deleteSsoInvitation(invitationId: string): Promise<void> {
		await db.delete(invitation).where(eq(invitation.id, invitationId));
	}

	/**
	 * Fetch accounts for a list of users, keyed by userId
	 */
	async getUserAccounts(userIds: string[]): Promise<Record<string, { id: string; providerId: string }[]>> {
		if (userIds.length === 0) return {};

		const accounts = await db
			.select({ id: account.id, providerId: account.providerId, userId: account.userId })
			.from(account)
			.where(inArray(account.userId, userIds));

		const grouped: Record<string, { id: string; providerId: string }[]> = {};
		for (const row of accounts) {
			if (!grouped[row.userId]) {
				grouped[row.userId] = [];
			}
			grouped[row.userId].push({ id: row.id, providerId: row.providerId });
		}
		return grouped;
	}

	/**
	 * Delete a single account for a user, refusing if it is the last one
	 */
	async deleteUserAccount(userId: string, accountId: string): Promise<{ lastAccount: boolean }> {
		const userAccounts = await db.select({ id: account.id }).from(account).where(eq(account.userId, userId));

		if (userAccounts.length <= 1) {
			return { lastAccount: true };
		}

		await db.delete(account).where(and(eq(account.id, accountId), eq(account.userId, userId)));
		return { lastAccount: false };
	}
}

export const authService = new AuthService();
