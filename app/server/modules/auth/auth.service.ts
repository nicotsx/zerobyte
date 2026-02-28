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
import type { UserDeletionImpactDto } from "./auth.dto";
import { isReservedSsoProviderId } from "~/server/lib/auth/utils/sso-provider-id";

export class AuthService {
	/**
	 * Check if any users exist in the system
	 */
	async hasUsers() {
		const [user] = await db.select({ id: usersTable.id }).from(usersTable).limit(1);
		return !!user;
	}

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
	 * Get the impact of deleting a user
	 */
	async getUserDeletionImpact(userId: string) {
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
	async cleanupUserOrganizations(userId: string) {
		const impact = await this.getUserDeletionImpact(userId);
		const orgIds = impact.organizations.map((o) => o.id);

		if (orgIds.length > 0) {
			await db.delete(organization).where(inArray(organization.id, orgIds));
		}
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
		const existingProvider = await db.query.ssoProvider.findFirst({
			where: { AND: [{ providerId }, { organizationId }] },
			columns: { id: true },
		});

		if (!existingProvider) {
			return false;
		}

		await db
			.update(ssoProvider)
			.set({ autoLinkMatchingEmails: enabled })
			.where(and(eq(ssoProvider.providerId, providerId), eq(ssoProvider.organizationId, organizationId)));

		return true;
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

	/**
	 * Check if a user is a member of an organization
	 */
	async getUserMembership(userId: string, organizationId: string) {
		return db.query.member.findFirst({
			where: { AND: [{ userId }, { organizationId }] },
			columns: { id: true },
		});
	}

	/**
	 * Fetch accounts for a list of users, keyed by userId
	 */
	async getUserAccounts(userIds: string[]) {
		if (userIds.length === 0) return {};

		const accounts = await db.query.account.findMany({
			where: { userId: { in: userIds } },
			columns: { id: true, providerId: true, userId: true },
		});

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
	 * Get all members of an organization with their user data
	 */
	async getOrgMembers(organizationId: string) {
		const members = await db.query.member.findMany({
			where: { organizationId },
			with: { user: true },
		});

		return {
			members: members.map((m) => ({
				id: m.id,
				userId: m.userId,
				role: m.role,
				createdAt: new Date(m.createdAt).toISOString(),
				user: {
					name: m.user.name,
					email: m.user.email,
				},
			})),
		};
	}

	/**
	 * Update a member's role in an organization.
	 * Cannot change the role of an owner.
	 */
	async updateMemberRole(memberId: string, organizationId: string, role: "member" | "admin") {
		const targetMember = await db.query.member.findFirst({
			where: { AND: [{ id: memberId }, { organizationId }] },
		});

		if (!targetMember) {
			return { found: false, isOwner: false } as const;
		}

		if (targetMember.role === "owner") {
			return { found: true, isOwner: true } as const;
		}

		await db.update(member).set({ role }).where(eq(member.id, memberId));

		return { found: true, isOwner: false } as const;
	}

	/**
	 * Remove a member from an organization.
	 * Cannot remove an owner.
	 */
	async removeOrgMember(memberId: string, organizationId: string) {
		const targetMember = await db.query.member.findFirst({
			where: { AND: [{ id: memberId }, { organizationId }] },
		});

		if (!targetMember) {
			return { found: false, isOwner: false } as const;
		}

		if (targetMember.role === "owner") {
			return { found: true, isOwner: true } as const;
		}

		await db.delete(member).where(eq(member.id, memberId));

		return { found: true, isOwner: false } as const;
	}

	/**
	 * Check if a user is an owner or admin in any organization
	 */
	async isOrgAdminAnywhere(userId: string) {
		const membership = await db.query.member.findFirst({
			where: {
				AND: [{ userId }, { role: { in: ["owner", "admin"] } }],
			},
		});

		return !!membership;
	}

	/**
	 * Delete a single account for a user, refusing if it is the last one
	 */
	async deleteUserAccount(userId: string, accountId: string, organizationId: string) {
		const membership = await this.getUserMembership(userId, organizationId);
		if (!membership) {
			return { lastAccount: false, forbidden: true };
		}

		return db.transaction(async (tx) => {
			const userAccounts = await tx.query.account.findMany({
				where: { userId },
				columns: { id: true },
			});

			if (userAccounts.length <= 1) {
				return { lastAccount: true, forbidden: false };
			}

			await tx.delete(account).where(and(eq(account.id, accountId), eq(account.userId, userId)));
			return { lastAccount: false, forbidden: false };
		});
	}
}

export const authService = new AuthService();
