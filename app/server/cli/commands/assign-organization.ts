import { select } from "@inquirer/prompts";
import { Command } from "commander";
import { eq } from "drizzle-orm";
import { toMessage } from "~/server/utils/errors";
import { db } from "../../db/db";
import { member, organization, sessionsTable, usersTable } from "../../db/schema";

const listUsers = () => {
	return db.select({ id: usersTable.id, username: usersTable.username }).from(usersTable);
};

const listOrganizations = () => {
	return db.select({ id: organization.id, name: organization.name, slug: organization.slug }).from(organization);
};

const getUserCurrentOrganization = async (userId: string) => {
	const membership = await db.query.member.findFirst({
		where: { userId },
		with: {
			organization: true,
		},
	});
	return membership;
};

const assignUserToOrganization = async (userId: string, organizationId: string) => {
	const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));

	if (!user) {
		throw new Error("User not found");
	}

	const [targetOrg] = await db.select().from(organization).where(eq(organization.id, organizationId));

	if (!targetOrg) {
		throw new Error("Organization not found");
	}

	const existingMembership = await db.query.member.findFirst({ where: { userId } });

	await db.transaction(async (tx) => {
		if (existingMembership) {
			await tx.update(member).set({ organizationId }).where(eq(member.id, existingMembership.id));
		} else {
			await tx.insert(member).values({
				id: Bun.randomUUIDv7(),
				organizationId,
				userId,
				role: "member",
				createdAt: new Date(),
			});
		}

		await tx.delete(sessionsTable).where(eq(sessionsTable.userId, userId));
	});
};

export const assignOrganizationCommand = new Command("assign-organization")
	.description("Assign a user to a different organization")
	.option("-u, --username <username>", "Username of the user to assign")
	.option("-o, --organization <organization>", "Organization slug to assign the user to")
	.action(async (options) => {
		console.info("\n🏢 Zerobyte Assign Organization\n");

		let username = options.username;
		let orgSlug = options.organization;

		try {
			if (!username) {
				const users = await listUsers();

				if (users.length === 0) {
					console.error("❌ No users found in the database.");
					console.info("   Please create a user first by starting the application.");
					process.exit(1);
				}

				username = await select({
					message: "Select user to assign:",
					choices: users.map((u) => ({ name: u.username, value: u.username })),
				});
			}

			const [user] = await db.select().from(usersTable).where(eq(usersTable.username, username));

			if (!user) {
				console.error(`\n❌ User "${username}" not found.`);
				process.exit(1);
			}

			const currentMembership = await getUserCurrentOrganization(user.id);

			if (!orgSlug) {
				const organizations = await listOrganizations();

				if (organizations.length === 0) {
					console.error("❌ No organizations found in the database.");
					process.exit(1);
				}

				const availableOrgs = organizations.filter((org) => org.id !== currentMembership?.organizationId);

				if (availableOrgs.length === 0) {
					console.error("❌ No other organizations available to assign to.");
					process.exit(1);
				}

				orgSlug = await select({
					message: "Select organization to assign the user to:",
					choices: availableOrgs.map((o) => ({
						name: `${o.name} (${o.slug})`,
						value: o.slug,
					})),
				});
			}

			const [targetOrg] = await db.select().from(organization).where(eq(organization.slug, orgSlug));

			if (!targetOrg) {
				console.error(`\n❌ Organization "${orgSlug}" not found.`);
				process.exit(1);
			}

			if (currentMembership?.organizationId === targetOrg.id) {
				console.error(`\n❌ User "${username}" is already assigned to organization "${targetOrg.name}".`);
				process.exit(1);
			}

			await assignUserToOrganization(user.id, targetOrg.id);

			console.info(`\n✅ User "${username}" has been assigned to organization "${targetOrg.name}" successfully.`);

			if (currentMembership) {
				console.info(`   Previous organization: ${currentMembership.organization.name}`);
			}

			console.info("   All existing sessions have been invalidated.");
		} catch (error) {
			console.error(`\n❌ Failed to assign organization: ${toMessage(error)}`);
			process.exit(1);
		}

		process.exit(0);
	});
