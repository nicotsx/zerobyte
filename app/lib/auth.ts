import {
	betterAuth,
	type AuthContext,
	type BetterAuthOptions,
	type MiddlewareContext,
	type MiddlewareOptions,
} from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { createAuthMiddleware, twoFactor, username, admin, organization } from "better-auth/plugins";
import { sso } from "@better-auth/sso";
import { convertLegacyUserOnFirstLogin } from "./auth-middlewares/convert-legacy-user";
import { cryptoUtils } from "~/server/utils/crypto";
import { db } from "~/server/db/db";
import { config } from "~/server/core/config";

export type AuthMiddlewareContext = MiddlewareContext<MiddlewareOptions, AuthContext<BetterAuthOptions>>;

const createBetterAuth = (secret: string) =>
	betterAuth({
		secret,
		trustedOrigins: config.trustedOrigins ?? ["*"],
		hooks: {
			before: createAuthMiddleware(async (ctx) => {
				await convertLegacyUserOnFirstLogin(ctx);
			}),
		},
		databaseHooks: {
			user: {
				create: {
					before: async (user) => {
						const anyUser = await db.query.usersTable.findFirst();
						const isFirstUser = !anyUser;

						if (isFirstUser) {
							user.role = "admin";
						}

						return { data: user };
					},
				},
			},
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
		plugins: [
			username(),
			admin({ defaultRole: "user" }),
			organization(),
			twoFactor({
				backupCodeOptions: {
					storeBackupCodes: "encrypted",
					amount: 5,
				},
			}),
			sso(),
		],
		account: {
			accountLinking: {
				enabled: true,
				allowDifferentEmails: true,
			},
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
