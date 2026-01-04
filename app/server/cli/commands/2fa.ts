import { Command } from "commander";
import { eq } from "drizzle-orm";
import { db } from "../../db/db";
import { sessionsTable, usersTable } from "../../db/schema";
import { logger } from "../../utils/logger";

const disableTwoFactor = async (username: string): Promise<void> => {
	const [user] = await db.select().from(usersTable).where(eq(usersTable.username, username));

	if (!user) {
		throw new Error(`User "${username}" not found`);
	}

	if (!user.totpEnabled || !user.totpSecret) {
		throw new Error(`2FA is not enabled for user "${username}"`);
	}

	await db.transaction(async (tx) => {
		await tx
			.update(usersTable)
			.set({
				totpSecret: null,
				totpEnabled: false,
				updatedAt: Date.now(),
			})
			.where(eq(usersTable.id, user.id));

		await tx.delete(sessionsTable).where(eq(sessionsTable.userId, user.id));
	});

	logger.warn(`2FA disabled via CLI for user: ${username}`);

	console.log(`\n✅ 2FA has been disabled for user "${username}".`);
	console.log("   All existing sessions have been invalidated.");
};

export const twoFactorCommand = new Command("2fa").description("Two-factor authentication recovery").addCommand(
	new Command("disable")
		.description("Disable 2FA for a user (recovery method when authenticator access is lost)")
		.requiredOption("-u, --username <username>", "Username of the account")
		.action(async (options) => {
			console.log("\n🔐 Zerobyte Two-Factor Authentication Recovery\n");

			try {
				await disableTwoFactor(options.username);
			} catch (error) {
				console.error(`\n❌ ${error instanceof Error ? error.message : "Unknown error"}`);
				process.exit(1);
			}

			process.exit(0);
		}),
);
