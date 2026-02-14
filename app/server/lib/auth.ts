import {
	betterAuth,
	type AuthContext,
	type BetterAuthOptions,
	type MiddlewareContext,
	type MiddlewareOptions,
} from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import {
	admin,
	createAuthMiddleware,
	twoFactor,
	username,
	organization,
} from "better-auth/plugins";
import { UnauthorizedError } from "http-errors-enhanced";
import { convertLegacyUserOnFirstLogin } from "./auth-middlewares/convert-legacy-user";
import { eq } from "drizzle-orm";
import { config } from "../core/config";
import { db } from "../db/db";
import { cryptoUtils } from "../utils/crypto";
import {
	organization as organizationTable,
	member,
	usersTable,
} from "../db/schema";
import { ensureOnlyOneUser } from "./auth-middlewares/only-one-user";
import { authService } from "../modules/auth/auth.service";
import { tanstackStartCookies } from "better-auth/tanstack-start";

export type AuthMiddlewareContext = MiddlewareContext<
	MiddlewareOptions,
	AuthContext<BetterAuthOptions>
>;

export const auth = betterAuth({
	secret: await cryptoUtils.deriveSecret("better-auth"),
	baseURL: config.baseUrl,
	trustedOrigins: config.trustedOrigins,
	advanced: {
		cookiePrefix: "zerobyte",
		useSecureCookies: config.isSecure,
	},
	onAPIError: {
		throw: true,
	},
	hooks: {
		before: createAuthMiddleware(async (ctx) => {
			await ensureOnlyOneUser(ctx);
			await convertLegacyUserOnFirstLogin(ctx);
		}),
	},
	database: drizzleAdapter(db, {
		provider: "sqlite",
	}),
	databaseHooks: {
		user: {
			delete: {
				before: async (user) => {
					await authService.cleanupUserOrganizations(user.id);
				},
			},
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
					const slug =
						user.email.split("@")[0] +
						"-" +
						Math.random().toString(36).slice(-4);

					const resticPassword = cryptoUtils.generateResticPassword();
					const metadata = {
						resticPassword:
							await cryptoUtils.sealSecret(resticPassword),
					};

					try {
						db.transaction((tx) => {
							const orgId = Bun.randomUUIDv7();

							tx.insert(organizationTable).values({
								name: `${user.name}'s Workspace`,
								slug: slug,
								id: orgId,
								createdAt: new Date(),
								metadata,
							}).run();

							tx.insert(member).values({
								id: Bun.randomUUIDv7(),
								userId: user.id,
								role: "owner",
								organizationId: orgId,
								createdAt: new Date(),
							}).run();
						});
					} catch {
						await db
							.delete(usersTable)
							.where(eq(usersTable.id, user.id));

						throw new Error(
							`Failed to create organization for user ${user.id}`,
						);
					}
				},
			},
		},
		session: {
			create: {
				before: async (session) => {
					const orgMembership = await db.query.member.findFirst({
						where: { userId: session.userId },
					});

					if (!orgMembership) {
						throw new UnauthorizedError(
							"User does not belong to any organization",
						);
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
		tanstackStartCookies(),
	],
});
