import { confirm, input, select } from "@inquirer/prompts";
import { Command } from "commander";
import { and, eq, ne } from "drizzle-orm";
import { toMessage } from "~/server/utils/errors";
import { db } from "../../db/db";
import { account, sessionsTable, usersTable } from "../../db/schema";

const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type EmailChangeImpact = {
	userId: string;
	previousEmail: string;
	updatedEmail: string;
	ssoAccounts: Array<{
		providerId: string;
		accountId: string;
	}>;
};

const listUsers = () => {
	return db.select({ id: usersTable.id, username: usersTable.username, email: usersTable.email }).from(usersTable);
};

export const changeEmailForUser = async (username: string, newEmail: string, precomputedImpact?: EmailChangeImpact) => {
	const impact = precomputedImpact ?? (await getEmailChangeImpact(username, newEmail));

	db.transaction((tx) => {
		tx.update(usersTable).set({ email: impact.updatedEmail }).where(eq(usersTable.id, impact.userId)).run();
		tx.delete(account)
			.where(and(eq(account.userId, impact.userId), ne(account.providerId, "credential")))
			.run();
		tx.delete(sessionsTable).where(eq(sessionsTable.userId, impact.userId)).run();
	});

	return {
		previousEmail: impact.previousEmail,
		updatedEmail: impact.updatedEmail,
		deletedSsoAccounts: impact.ssoAccounts.length,
	};
};

export const getEmailChangeImpact = async (username: string, newEmail: string): Promise<EmailChangeImpact> => {
	const normalizedEmail = newEmail.trim().toLowerCase();

	if (!emailRegex.test(normalizedEmail)) {
		throw new Error(`Invalid email address "${newEmail}"`);
	}

	const [user] = await db.select().from(usersTable).where(eq(usersTable.username, username));

	if (!user) {
		throw new Error(`User "${username}" not found`);
	}

	const [existingUser] = await db
		.select({ id: usersTable.id })
		.from(usersTable)
		.where(and(eq(usersTable.email, normalizedEmail), ne(usersTable.id, user.id)));

	if (existingUser) {
		throw new Error(`Email "${normalizedEmail}" is already in use`);
	}

	const [credentialAccount] = await db
		.select({ id: account.id })
		.from(account)
		.where(and(eq(account.userId, user.id), eq(account.providerId, "credential")));

	if (!credentialAccount) {
		throw new Error(`User "${username}" has no credential account. Reset their password before changing email.`);
	}

	const ssoAccounts = (
		await db
			.select({
				providerId: account.providerId,
				accountId: account.accountId,
			})
			.from(account)
			.where(and(eq(account.userId, user.id), ne(account.providerId, "credential")))
	).sort((left, right) => {
		const providerCompare = left.providerId.localeCompare(right.providerId);
		if (providerCompare !== 0) {
			return providerCompare;
		}

		return left.accountId.localeCompare(right.accountId);
	});

	return {
		userId: user.id,
		previousEmail: user.email,
		updatedEmail: normalizedEmail,
		ssoAccounts,
	};
};

export const changeEmailCommand = new Command("change-email")
	.description("Change email for a user and remove linked SSO accounts")
	.option("-u, --username <username>", "Username of the account")
	.option("-e, --email <email>", "New email for the account")
	.action(async (options) => {
		console.info("\n📧 Zerobyte Change Email\n");

		let username = options.username;
		let newEmail = options.email;

		try {
			if (!username) {
				const users = await listUsers();

				if (users.length === 0) {
					console.error("❌ No users found in the database.");
					console.info("   Please create a user first by starting the application.");
					process.exit(1);
				}

				username = await select({
					message: "Select user to change email for:",
					choices: users.map((user) => ({
						name: `${user.username} (${user.email})`,
						value: user.username,
					})),
				});
			}

			if (!newEmail) {
				newEmail = await input({
					message: "Enter the new email:",
					validate: (value) => {
						if (!emailRegex.test(value.trim())) {
							return "Please enter a valid email address";
						}

						return true;
					},
				});
			}

			const impact = await getEmailChangeImpact(username, newEmail);

			if (impact.ssoAccounts.length > 0) {
				console.warn("\n⚠️  Disclaimer: changing this email will delete the following linked SSO account(s):");
				for (const ssoAccount of impact.ssoAccounts) {
					console.warn(`   - ${ssoAccount.providerId} (${ssoAccount.accountId})`);
				}
				console.warn(
					"   The user will need to be invited again using the new email to regain access with those SSO providers.",
				);

				const shouldContinue = await confirm({
					message: `Continue and delete ${impact.ssoAccounts.length} SSO account(s) for "${username}"?`,
					default: false,
				});

				if (!shouldContinue) {
					console.info("\nℹ️  Email change cancelled. No data was modified.");
					process.exit(0);
				}
			}

			const result = await changeEmailForUser(username, newEmail, impact);

			console.info(`\n✅ Email for "${username}" changed from "${result.previousEmail}" to "${result.updatedEmail}".`);
			if (result.deletedSsoAccounts > 0) {
				console.info(`   Deleted ${result.deletedSsoAccounts} linked SSO account(s).`);
			}
			console.info("   All existing sessions have been invalidated.");
		} catch (error) {
			console.error(`\n❌ Failed to change email: ${toMessage(error)}`);
			process.exit(1);
		}

		process.exit(0);
	});
