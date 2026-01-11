import { input, select } from "@inquirer/prompts";
import { Command } from "commander";
import { eq } from "drizzle-orm";
import { toMessage } from "~/server/utils/errors";
import { db } from "../../db/db";
import { sessionsTable, usersTable } from "../../db/schema";

const listUsers = () => {
	return db.select({ id: usersTable.id, username: usersTable.username }).from(usersTable);
};

const changeUsername = async (oldUsername: string, newUsername: string) => {
	const [user] = await db.select().from(usersTable).where(eq(usersTable.username, oldUsername));

	if (!user) {
		throw new Error(`User "${oldUsername}" not found`);
	}

	const normalizedUsername = newUsername.toLowerCase().trim();

	const [existingUser] = await db.select().from(usersTable).where(eq(usersTable.username, normalizedUsername));
	if (existingUser) {
		throw new Error(`Username "${newUsername}" is already taken`);
	}

	const usernameRegex = /^[a-z0-9_]{3,30}$/;
	if (!usernameRegex.test(normalizedUsername)) {
		throw new Error(
			`Invalid username "${newUsername}". Usernames must be 3-30 characters long and can only contain lowercase letters, numbers, and underscores.`,
		);
	}

	await db.transaction(async (tx) => {
		await tx.update(usersTable).set({ username: normalizedUsername }).where(eq(usersTable.id, user.id));
		await tx.delete(sessionsTable).where(eq(sessionsTable.userId, user.id));
	});
};

export const changeUsernameCommand = new Command("change-username")
	.description("Change username for a user")
	.option("-u, --username <username>", "Current username of the account")
	.option("-n, --new-username <new-username>", "New username for the account")
	.action(async (options) => {
		console.info("\n👤 Zerobyte Change Username\n");

		let username = options.username;
		let newUsername = options.newUsername;

		try {
			if (!username) {
				const users = await listUsers();

				if (users.length === 0) {
					console.error("No users found in the database.");
					return;
				}

				username = await select({
					message: "Select a user to change username for:",
					choices: users.map((u) => ({
						name: u.username,
						value: u.username,
					})),
				});
			}

			if (!newUsername) {
				newUsername = await input({
					message: "Enter the new username:",
					validate: (val) => {
						const usernameRegex = /^[a-z0-9_]{3,30}$/;
						return usernameRegex.test(val)
							? true
							: "Username must be 3-30 characters and contain only lowercase letters, numbers, or underscores";
					},
				});
				newUsername = newUsername.toLowerCase().trim();
			}

			await changeUsername(username, newUsername);
			console.info(`\n✅ Username for "${username}" has been changed to "${newUsername}" successfully.`);
		} catch (error) {
			console.error(`\n❌ Error: ${toMessage(error)}`);
			process.exit(1);
		}
	});
