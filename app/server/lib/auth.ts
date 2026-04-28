import {
	betterAuth,
	type AuthContext,
	type BetterAuthOptions,
	type MiddlewareContext,
	type MiddlewareOptions,
} from "better-auth";
import { APIError } from "better-auth/api";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { admin, twoFactor, username, organization, testUtils } from "better-auth/plugins";
import { passkey } from "@better-auth/passkey";
import { createAuthMiddleware } from "better-auth/api";
import { config } from "../core/config";
import { db } from "../db/db";
import { cryptoUtils } from "../utils/crypto";
import { authService } from "../modules/auth/auth.service";
import { tanstackStartCookies } from "better-auth/tanstack-start";
import { isValidUsername, normalizeUsername } from "~/lib/username";
import { ensureOnlyOneUser } from "./auth/middlewares/only-one-user";
import { convertLegacyUserOnFirstLogin } from "./auth/middlewares/convert-legacy-user";
import { ensureDefaultOrg } from "./auth/helpers/create-default-org";
import { ssoIntegration } from "../modules/sso/sso.integration";

export type AuthMiddlewareContext = MiddlewareContext<MiddlewareOptions, AuthContext<BetterAuthOptions>>;

export const auth = betterAuth({
	secret: await cryptoUtils.deriveSecret("better-auth"),
	baseURL: {
		allowedHosts: config.allowedHosts,
		protocol: "auto",
	},
	trustedOrigins: config.trustedOrigins,
	rateLimit: {
		enabled: !config.flags.disableRateLimiting,
	},
	advanced: {
		cookiePrefix: "zerobyte",
		useSecureCookies: config.isSecure,
		ipAddress: {
			disableIpTracking: config.flags.disableRateLimiting,
		},
	},
	onAPIError: {
		throw: true,
	},
	hooks: {
		before: createAuthMiddleware(async (ctx) => {
			for (const mw of ssoIntegration.beforeMiddlewares) {
				await mw(ctx);
			}

			await ensureOnlyOneUser(ctx);
			await convertLegacyUserOnFirstLogin(ctx);
		}),
	},
	database: drizzleAdapter(db, {
		provider: "sqlite",
	}),
	databaseHooks: {
		account: {
			create: {
				before: async (account, ctx) => {
					if (ssoIntegration.isSsoCallback(ctx)) {
						const allowed = await ssoIntegration.canLinkSsoAccount(account.userId, account.providerId);
						if (!allowed) {
							throw new APIError("FORBIDDEN", {
								message: "SSO account linking is not permitted for users outside this organization",
							});
						}
					}
				},
			},
		},
		user: {
			delete: {
				before: async (user) => {
					await authService.cleanupUserOrganizations(user.id);
				},
			},
			create: {
				before: async (user, ctx) => {
					if (ssoIntegration.isSsoCallback(ctx)) {
						await ssoIntegration.onUserCreate(user, ctx);
					}

					const anyUser = await db.query.usersTable.findFirst();
					const isFirstUser = !anyUser;

					if (isFirstUser) {
						user.role = "admin";
					}

					if (!user.username) {
						user.username = Bun.randomUUIDv7();
					}

					return { data: user };
				},
				after: async (user, ctx) => {
					if (ssoIntegration.isSsoCallback(ctx)) {
						await ssoIntegration.onUserCreated(user, ctx);
					}
				},
			},
		},
		session: {
			create: {
				before: async (session, ctx) => {
					if (ssoIntegration.isSsoCallback(ctx)) {
						const membership = await ssoIntegration.resolveOrgMembershipOrThrow(session.userId, ctx);
						return { data: { ...session, activeOrganizationId: membership.organizationId } };
					}

					const membership = await ensureDefaultOrg(session.userId);

					return { data: { ...session, activeOrganizationId: membership.organizationId } };
				},
			},
		},
	},
	emailAndPassword: {
		enabled: true,
	},
	account: {
		accountLinking: {
			enabled: true,
			trustedProviders: ssoIntegration.resolveTrustedProviders,
		},
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
			dateFormat: {
				type: "string",
				returned: true,
			},
			timeFormat: {
				type: "string",
				returned: true,
			},
		},
	},
	session: {
		modelName: "sessionsTable",
	},
	plugins: [
		username({
			usernameValidator: isValidUsername,
			usernameNormalization: normalizeUsername,
		}),
		admin({
			defaultRole: "user",
		}),
		organization({
			allowUserToCreateOrganization: false,
		}),
		ssoIntegration.plugin,
		twoFactor({
			backupCodeOptions: {
				storeBackupCodes: "encrypted",
				amount: 5,
			},
		}),
		passkey({
			rpID: new URL(config.baseUrl).hostname,
			rpName: "Zerobyte",
		}),
		tanstackStartCookies(),
		...(process.env.NODE_ENV === "test" ? [testUtils()] : []),
	],
});
