import { createAuthClient } from "better-auth/react";
import { organizationClient, twoFactorClient, usernameClient } from "better-auth/client/plugins";
import { inferAdditionalFields } from "better-auth/client/plugins";
import { ssoClient } from "@better-auth/sso/client";
import { adminClient } from "better-auth/client/plugins";
import type { auth } from "~/lib/auth";

export const authClient = createAuthClient({
	plugins: [
		inferAdditionalFields<typeof auth>(),
		usernameClient(),
		adminClient(),
		organizationClient(),
		twoFactorClient(),
		ssoClient(),
	],
});
