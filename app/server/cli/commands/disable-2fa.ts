import { select } from "@inquirer/prompts";
import { Command } from "commander";
import { eq } from "drizzle-orm";
import { toMessage } from "~/server/utils/errors";
import { db } from "../../db/db";
import { twoFactor, usersTable } from "../../db/schema";

const listUsers = () => {
	return db
		.select({ id: usersTable.id, username: usersTable.username })
		.from(usersTable);
};

const disable2FA = async (username: string) => {
	const [user] = await db
		.select()
		.from(usersTable)
		.where(eq(usersTable.username, username));

	if (!user) {
		throw new Error(`User "${username}" not found`);
	}

	if (!user.twoFactorEnabled) {
		throw new Error(`User "${username}" does not have 2FA enabled`);
	}

	await db.transaction(async (tx) => {
		await tx
			.update(usersTable)
			.set({ twoFactorEnabled: false })
			.where(eq(usersTable.id, user.id));
		await tx.delete(twoFactor).where(eq(twoFactor.userId, user.id));
	});
};

export const disable2FACommand = new Command("disable-2fa")
	.description("Disable two-factor authentication for a user")
	.option("-u, --username <username>", "Username of the account")
	.action(async (options) => {
		console.log("\n🔐 Zerobyte 2FA Disable\n");

		let username = options.username;

		if (!username) {
			const users = await listUsers();

			if (users.length === 0) {
				console.error("❌ No users found in the database.");
				console.log(
					"   Please create a user first by starting the application.",
				);
				process.exit(1);
			}

			username = await select({
				message: "Select user to disable 2FA for:",
				choices: users.map((u) => ({ name: u.username, value: u.username })),
			});
		}

		try {
			await disable2FA(username);
			console.log(
				`\n✅ Two-factor authentication has been disabled for user "${username}".`,
			);
			console.log("   The user can re-enable 2FA from their account settings.");
		} catch (error) {
			console.error(`\n❌ Failed to disable 2FA: ${toMessage(error)}`);
			process.exit(1);
		}

		process.exit(0);
	});
