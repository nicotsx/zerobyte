import { eq } from "drizzle-orm";
import { verifyPassword } from "better-auth/crypto";
import type { Context } from "hono";
import { deleteCookie } from "hono/cookie";
import { hasRuntimeFeature } from "~/lib/permission-policy";
import { config } from "~/server/core/config";
import { db } from "~/server/db/db";
import { passkey, usersTable } from "~/server/db/schema";
import { auth } from "~/server/lib/auth";

type PasswordVerificationBody = {
	userId: string;
	password: string;
};

type SessionAuthSource = "browser-session" | "desktop-session";

export const getSessionAuthSource = (authSource: string | null | undefined): SessionAuthSource =>
	authSource === "desktop-session" ? "desktop-session" : "browser-session";

export const isSessionAuthSourceAllowed = (authSource: string | null | undefined) =>
	getSessionAuthSource(authSource) === (config.runtime === "desktop" ? "desktop-session" : "browser-session");

export const invalidateAuthSession = async (token: string, c?: Context) => {
	const authContext = await auth.$context;
	await authContext.internalAdapter.deleteSession(token);

	if (c) {
		for (const cookie of Object.values(authContext.authCookies)) {
			deleteCookie(c, cookie.name, cookie.attributes);
		}
	}
};

export const isPasswordAuthSupported = () => hasRuntimeFeature(config.runtime, "passwordAuthentication");

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

export const userHasPassword = async (userId: string) => {
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
