import { password, select } from "@inquirer/prompts";
import { hashPassword } from "better-auth/crypto";
import { Command } from "commander";
import { and, eq } from "drizzle-orm";
import { toMessage } from "~/server/utils/errors";
import { db } from "../../db/db";
import { account, sessionsTable, usersTable } from "../../db/schema";

const listUsers = () => {
	return db
		.select({ id: usersTable.id, username: usersTable.username })
		.from(usersTable);
};

const resetPassword = async (username: string, newPassword: string) => {
	const [user] = await db
		.select()
		.from(usersTable)
		.where(eq(usersTable.username, username));

	if (!user) {
		throw new Error(`User "${username}" not found`);
	}

	const newPasswordHash = await hashPassword(newPassword);

	await db.transaction(async (tx) => {
		await tx
			.update(account)
			.set({ password: newPasswordHash })
			.where(
				and(eq(account.userId, user.id), eq(account.providerId, "credential")),
			);

		if (user.passwordHash) {
			const legacyHash = await Bun.password.hash(newPassword);
			await tx
				.update(usersTable)
				.set({ passwordHash: legacyHash })
				.where(eq(usersTable.id, user.id));
		}

		await tx.delete(sessionsTable).where(eq(sessionsTable.userId, user.id));
	});
};

export const resetPasswordCommand = new Command("reset-password")
	.description("Reset password for a user")
	.option("-u, --username <username>", "Username of the account")
	.option("-p, --password <password>", "New password for the account")
	.action(async (options) => {
		console.log("\n🔐 Zerobyte Password Reset\n");

		let username = options.username;
		let newPassword = options.password;

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
				message: "Select user to reset password for:",
				choices: users.map((u) => ({ name: u.username, value: u.username })),
			});
		}

		if (!newPassword) {
			newPassword = await password({
				message: "Enter new password:",
				mask: "*",
				validate: (value) => {
					if (value.length < 8) {
						return "Password must be at least 8 characters long";
					}
					return true;
				},
			});

			const confirmPassword = await password({
				message: "Confirm new password:",
				mask: "*",
			});

			if (newPassword !== confirmPassword) {
				console.error("\n❌ Passwords do not match.");
				process.exit(1);
			}
		} else if (newPassword.length < 8) {
			console.error("\n❌ Password must be at least 8 characters long.");
			process.exit(1);
		}

		try {
			await resetPassword(username, newPassword);
			console.log(
				`\n✅ Password for user "${username}" has been reset successfully.`,
			);
			console.log("   All existing sessions have been invalidated.");
		} catch (error) {
			console.error(`\n❌ Failed to reset password: ${toMessage(error)}`);
			process.exit(1);
		}

		process.exit(0);
	});
