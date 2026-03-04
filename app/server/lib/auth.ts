import {
	betterAuth,
	type AuthContext,
	type BetterAuthOptions,
	type MiddlewareContext,
	type MiddlewareOptions,
} from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { admin, twoFactor, username, organization, testUtils } from "better-auth/plugins";
import { createAuthMiddleware } from "better-auth/api";
import { config } from "../core/config";
import { db } from "../db/db";
import { cryptoUtils } from "../utils/crypto";
import { logger } from "../utils/logger";
import { authService } from "../modules/auth/auth.service";
import { tanstackStartCookies } from "better-auth/tanstack-start";
import { isValidUsername, normalizeUsername } from "~/lib/username";
import { ensureOnlyOneUser } from "./auth/middlewares/only-one-user";
import { convertLegacyUserOnFirstLogin } from "./auth/middlewares/convert-legacy-user";
import { ensureDefaultOrg } from "./auth/helpers/create-default-org";
import { buildAllowedHosts } from "./auth/base-url";
import { ssoIntegration } from "../modules/sso/sso.integration";

export type AuthMiddlewareContext = MiddlewareContext<MiddlewareOptions, AuthContext<BetterAuthOptions>>;

const authOrigins = [config.baseUrl, ...config.trustedOrigins];
const { allowedHosts, invalidOrigins } = buildAllowedHosts(authOrigins);

for (const origin of invalidOrigins) {
	logger.warn(`Ignoring invalid auth origin in configuration: ${origin}`);
}

export const auth = betterAuth({
	secret: await cryptoUtils.deriveSecret("better-auth"),
	baseURL: {
		allowedHosts,
		protocol: "auto",
	},
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
			},
		},
		session: {
			create: {
				before: async (session, ctx) => {
					const membership =
						(await ssoIntegration.resolveOrgMembership(session.userId, ctx)) ??
						(await ensureDefaultOrg(session.userId));
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
		tanstackStartCookies(),
		...(process.env.NODE_ENV === "test" ? [testUtils()] : []),
	],
});
