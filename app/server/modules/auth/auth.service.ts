import { db } from "../../db/db";
import {
	usersTable,
	member,
	organization,
	sessionsTable,
	volumesTable,
	repositoriesTable,
	backupSchedulesTable,
	account,
} from "../../db/schema";
import { eq, ne, and, count, inArray } from "drizzle-orm";
import type { UserDeletionImpactDto } from "./auth.dto";

class AuthService {
	/**
	 * Check if any users exist in the system
	 */
	async hasUsers() {
		const [user] = await db.select({ id: usersTable.id }).from(usersTable).limit(1);
		return !!user;
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

		if (orgIds.length === 0) {
			return;
		}

		db.transaction((tx) => {
			const membersInDeletedOrgs = tx.query.member
				.findMany({
					where: {
						AND: [{ organizationId: { in: orgIds } }, { userId: { ne: userId } }],
					},
					columns: { userId: true },
				})
				.sync();

			const affectedUserIds = [...new Set(membersInDeletedOrgs.map((r) => r.userId))];

			if (affectedUserIds.length > 0) {
				const memberships = tx.query.member
					.findMany({
						where: {
							userId: { in: affectedUserIds },
						},
					})
					.sync();

				const orgIdSet = new Set(orgIds);
				const fallbackOrgByUser = new Map<string, string | null>(affectedUserIds.map((id) => [id, null]));

				for (const { userId, organizationId } of memberships) {
					if (!orgIdSet.has(organizationId) && fallbackOrgByUser.get(userId) === null) {
						fallbackOrgByUser.set(userId, organizationId);
					}
				}

				for (const [affectedUserId, fallbackOrgId] of fallbackOrgByUser) {
					tx.update(sessionsTable)
						.set({ activeOrganizationId: fallbackOrgId })
						.where(and(eq(sessionsTable.userId, affectedUserId), inArray(sessionsTable.activeOrganizationId, orgIds)))
						.run();
				}
			}

			tx.delete(organization).where(inArray(organization.id, orgIds)).run();

			tx.update(sessionsTable)
				.set({ activeOrganizationId: null })
				.where(inArray(sessionsTable.activeOrganizationId, orgIds))
				.run();
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
			grouped[row.userId].push({
				id: row.id,
				providerId: row.providerId,
			});
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

		db.transaction((tx) => {
			const fallbackMembership = tx.query.member
				.findFirst({
					where: {
						AND: [{ userId: targetMember.userId }, { organizationId: { ne: organizationId } }],
					},
					columns: { organizationId: true },
				})
				.sync();

			tx.delete(member).where(eq(member.id, memberId)).run();

			if (fallbackMembership?.organizationId) {
				tx.update(sessionsTable)
					.set({
						activeOrganizationId: fallbackMembership.organizationId,
					})
					.where(
						and(eq(sessionsTable.userId, targetMember.userId), eq(sessionsTable.activeOrganizationId, organizationId)),
					)
					.run();
				return;
			}

			tx.delete(sessionsTable).where(eq(sessionsTable.userId, targetMember.userId)).run();
		});

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
	async deleteUserAccount(userId: string, accountId: string) {
		return db.transaction((tx) => {
			const targetAccount = tx.query.account
				.findFirst({
					where: {
						AND: [{ id: accountId }, { userId }],
					},
				})
				.sync();

			if (!targetAccount) {
				return { lastAccount: false, notFound: true };
			}

			const userAccounts = tx.query.account
				.findMany({
					where: { userId },
					columns: { id: true },
				})
				.sync();

			if (userAccounts.length <= 1) {
				return { lastAccount: true, notFound: false };
			}

			tx.delete(account)
				.where(and(eq(account.id, accountId), eq(account.userId, userId)))
				.run();

			return { lastAccount: false, notFound: false };
		});
	}
}

export const authService = new AuthService();
