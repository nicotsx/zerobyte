import type { BetterAuthPlugin } from "better-auth";
import { createAuthMiddleware } from "better-auth/api";
import { isSsoCallbackPath, trustSsoProviderForLinking } from "../middlewares/trust-sso-provider-for-linking";

export function ssoTrustedProviderLinkingPlugin(): BetterAuthPlugin {
	return {
		id: "sso-trusted-provider-linking",
		hooks: {
			before: [
				{
					matcher(context) {
						return isSsoCallbackPath(context.path);
					},
					handler: createAuthMiddleware(async (ctx) => {
						await trustSsoProviderForLinking(ctx);
					}),
				},
			],
		},
	};
}
