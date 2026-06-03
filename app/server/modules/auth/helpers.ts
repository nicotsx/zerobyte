import { eq } from "drizzle-orm";
import { verifyPassword } from "better-auth/crypto";
import { db } from "~/server/db/db";
import { passkey, usersTable } from "~/server/db/schema";

type PasswordVerificationBody = {
	userId: string;
	password: string;
};

export const verifyUserPassword = async ({ password, userId }: PasswordVerificationBody) => {
	const userAccount = await db.query.account.findFirst({
		where: { AND: [{ userId }, { providerId: "credential" }] },
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

export const userHasCredentialPassword = async (userId: string) => {
	const userAccount = await db.query.account.findFirst({
		where: { AND: [{ userId }, { providerId: "credential" }] },
		columns: { password: true },
	});

	return Boolean(userAccount?.password);
};

export const hasActivePasskeyUser = async () => {
	const [user] = await db
		.select({ id: usersTable.id })
		.from(passkey)
		.innerJoin(usersTable, eq(passkey.userId, usersTable.id))
		.where(eq(usersTable.banned, false))
		.limit(1);

	return Boolean(user);
};
