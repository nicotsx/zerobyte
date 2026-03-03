import {
	betterAuth,
	type AuthContext,
	type BetterAuthOptions,
	type MiddlewareContext,
	type MiddlewareOptions,
	type User,
} from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { admin, twoFactor, username, organization, testUtils } from "better-auth/plugins";
import { createAuthMiddleware } from "better-auth/api";
import { sso } from "@better-auth/sso";
import { config } from "../core/config";
import { db } from "../db/db";
import { cryptoUtils } from "../utils/crypto";
import { logger } from "../utils/logger";
import { authService } from "../modules/auth/auth.service";
import { tanstackStartCookies } from "better-auth/tanstack-start";
import { isValidUsername, normalizeUsername } from "~/lib/username";
import { ensureOnlyOneUser } from "./auth/middlewares/only-one-user";
import { convertLegacyUserOnFirstLogin } from "./auth/middlewares/convert-legacy-user";
import { validateSsoCallbackUrls } from "./auth/middlewares/validate-sso-callback-urls";
import { validateSsoProviderId } from "./auth/middlewares/validate-sso-provider-id";
import { createUserDefaultOrg } from "./auth/helpers/create-default-org";
import { isSsoCallbackRequest, requireSsoInvitation } from "./auth/middlewares/require-sso-invitation";
import { resolveTrustedProvidersForRequest } from "./auth/middlewares/trust-sso-provider-for-linking";
import { buildAllowedHosts } from "./auth/base-url";

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
			await validateSsoProviderId(ctx);
			await validateSsoCallbackUrls(ctx);
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
					if (isSsoCallbackRequest(ctx)) {
						await requireSsoInvitation(user.email, ctx);
						user.hasDownloadedResticPassword = true;
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
					const membership = await createUserDefaultOrg(session.userId, ctx);
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
			trustedProviders: resolveTrustedProvidersForRequest,
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
		sso({
			trustEmailVerified: false,
			providersLimit: async (user: User) => {
				const isOrgAdmin = await authService.isOrgAdminAnywhere(user.id);
				return isOrgAdmin ? 10 : 0;
			},
			organizationProvisioning: {
				disabled: false,
				defaultRole: "member",
			},
		}),
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
