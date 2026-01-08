import {
	betterAuth,
	type AuthContext,
	type BetterAuthOptions,
	type MiddlewareContext,
	type MiddlewareOptions,
} from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { createAuthMiddleware, username } from "better-auth/plugins";
import { convertLegacyUserOnFirstLogin } from "./auth-middlewares/convert-legacy-user";
import { cryptoUtils } from "~/server/utils/crypto";
import { db } from "~/server/db/db";
import { ensureOnlyOneUser } from "./auth-middlewares/only-one-user";

export type AuthMiddlewareContext = MiddlewareContext<MiddlewareOptions, AuthContext<BetterAuthOptions>>;

const createBetterAuth = (secret: string) =>
	betterAuth({
		secret,
		hooks: {
			before: createAuthMiddleware(async (ctx) => {
				await ensureOnlyOneUser(ctx);
				await convertLegacyUserOnFirstLogin(ctx);
			}),
		},
		database: drizzleAdapter(db, {
			provider: "sqlite",
		}),
		emailAndPassword: {
			enabled: true,
		},
		user: {
			modelName: "usersTable",
			additionalFields: {
				username: {
					type: "string",
					returned: true,
					required: true,
				},
				hasDownloadedResticPassword: {
					type: "boolean",
					returned: true,
				},
			},
		},
		session: {
			modelName: "sessionsTable",
		},
		plugins: [username({})],
		advanced: {
			disableOriginCheck: true,
		},
	});

type Auth = ReturnType<typeof createBetterAuth>;

let _auth: Auth | null = null;

const createAuth = async (): Promise<Auth> => {
	if (_auth) return _auth;

	_auth = createBetterAuth(await cryptoUtils.deriveSecret("better-auth"));

	return _auth;
};

export const auth = new Proxy(
	{},
	{
		get(_, prop, receiver) {
			if (!_auth) {
				throw new Error("Auth not initialized. Call initAuth() first.");
			}
			return Reflect.get(_auth, prop, receiver);
		},
	},
) as Auth;

export const initAuth = createAuth;
