import { createAuthClient } from "better-auth/react";
import {
	twoFactorClient,
	usernameClient,
	adminClient,
	organizationClient,
	inferAdditionalFields,
} from "better-auth/client/plugins";
import { ssoClient } from "@better-auth/sso/client";
import { passkeyClient } from "@better-auth/passkey/client";
import type { auth } from "~/server/lib/auth";

export const authClient = createAuthClient({
	plugins: [
		inferAdditionalFields<typeof auth>(),
		usernameClient(),
		adminClient(),
		organizationClient(),
		ssoClient(),
		twoFactorClient(),
		passkeyClient(),
	],
});
