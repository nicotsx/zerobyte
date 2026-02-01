import { db } from "../../db/db";
import {
	usersTable,
	member,
	organization,
	volumesTable,
	repositoriesTable,
	backupSchedulesTable,
} from "../../db/schema";
import { eq, ne, and, count, inArray } from "drizzle-orm";
import type { UserDeletionImpactDto } from "./auth.dto";

export class AuthService {
	/**
	 * Check if any users exist in the system
	 */
	async hasUsers(): Promise<boolean> {
		const [user] = await db.select({ id: usersTable.id }).from(usersTable).limit(1);
		return !!user;
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
}

export const authService = new AuthService();
