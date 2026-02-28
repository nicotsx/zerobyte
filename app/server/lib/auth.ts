import {
	betterAuth,
	type AuthContext,
	type BetterAuthOptions,
	type MiddlewareContext,
	type MiddlewareOptions,
	type User,
} from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { admin, createAuthMiddleware, twoFactor, username, organization } from "better-auth/plugins";
import { sso } from "@better-auth/sso";
import { config } from "../core/config";
import { db } from "../db/db";
import { cryptoUtils } from "../utils/crypto";
import { authService } from "../modules/auth/auth.service";
import { tanstackStartCookies } from "better-auth/tanstack-start";
import { isValidUsername, normalizeUsername } from "~/lib/username";
import { ensureOnlyOneUser } from "./auth/middlewares/only-one-user";
import { convertLegacyUserOnFirstLogin } from "./auth/middlewares/convert-legacy-user";
import { validateSsoCallbackUrls } from "./auth/middlewares/validate-sso-callback-urls";
import { validateSsoProviderId } from "./auth/middlewares/validate-sso-provider-id";
import { createUserDefaultOrg } from "./auth/helpers/create-default-org";
import { isSsoCallbackRequest, requireSsoInvitation } from "./auth/middlewares/require-sso-invitation";
import { ssoTrustedProviderLinkingPlugin } from "./auth/plugins/sso-trusted-provider-linking";

export type AuthMiddlewareContext = MiddlewareContext<MiddlewareOptions, AuthContext<BetterAuthOptions>>;

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
		ssoTrustedProviderLinkingPlugin(),
		twoFactor({
			backupCodeOptions: {
				storeBackupCodes: "encrypted",
				amount: 5,
			},
		}),
		tanstackStartCookies(),
	],
});
