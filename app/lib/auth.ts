import {
	betterAuth,
	type AuthContext,
	type BetterAuthOptions,
	type MiddlewareContext,
	type MiddlewareOptions,
} from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { admin, createAuthMiddleware, twoFactor, username, organization } from "better-auth/plugins";
import { convertLegacyUserOnFirstLogin } from "./auth-middlewares/convert-legacy-user";
import { cryptoUtils } from "~/server/utils/crypto";
import { db } from "~/server/db/db";
import { member, organization as organizationTable } from "~/server/db/schema";
import { config } from "~/server/core/config";
import { eq } from "drizzle-orm";

export type AuthMiddlewareContext = MiddlewareContext<MiddlewareOptions, AuthContext<BetterAuthOptions>>;

const createBetterAuth = (secret: string) =>
	betterAuth({
		secret,
		trustedOrigins: config.trustedOrigins ?? ["*"],
		hooks: {
			before: createAuthMiddleware(async (ctx) => {
				// await ensureOnlyOneUser(ctx);
				await convertLegacyUserOnFirstLogin(ctx);
			}),
		},
		database: drizzleAdapter(db, {
			provider: "sqlite",
		}),
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
					after: async (user) => {
						const slug = user.email.split("@")[0] + "-" + Math.random().toString(36).slice(-4);

						await db.transaction(async (tx) => {
							const orgId = Bun.randomUUIDv7();

							await tx.insert(organizationTable).values({
								name: `${user.name}'s Workspace`,
								slug: slug,
								id: orgId,
								createdAt: new Date(),
							});

							await tx.insert(member).values({
								id: Bun.randomUUIDv7(),
								userId: user.id,
								role: "owner",
								organizationId: orgId,
								createdAt: new Date(),
							});
						});
					},
				},
			},
			session: {
				create: {
					before: async (session) => {
						const orgMembership = await db.query.member.findFirst({
							where: eq(member.userId, session.userId),
						});

						if (!orgMembership) {
							throw new Error("User does not belong to any organization");
						}

						return {
							data: {
								...session,
								activeOrganizationId: orgMembership?.organizationId,
							},
						};
					},
				},
			},
		},
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
			admin({
				defaultRole: "user",
			}),
			organization({
				allowUserToCreateOrganization: false,
			}),
			twoFactor({
				backupCodeOptions: {
					storeBackupCodes: "encrypted",
					amount: 5,
				},
			}),
		],
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
