import { verifyPassword } from "better-auth/crypto";
import { eq } from "drizzle-orm";
import { db } from "~/server/db/db";
import { account } from "~/server/db/schema";

type PasswordVerificationBody = {
	userId: string;
	password: string;
};

export const verifyUserPassword = async ({ password, userId }: PasswordVerificationBody) => {
	const userAccount = await db.query.account.findFirst({
		where: eq(account.userId, userId),
	});

	if (!userAccount || !userAccount.password) {
		return false;
	}

	const isPasswordValid = await verifyPassword({ password: password, hash: userAccount.password });
	if (!isPasswordValid) {
		return false;
	}

	return true;
};
