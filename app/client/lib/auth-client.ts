import { createAuthClient } from "better-auth/react";
import { twoFactorClient, usernameClient, adminClient, organizationClient } from "better-auth/client/plugins";
import { inferAdditionalFields } from "better-auth/client/plugins";
import type { auth } from "~/lib/auth";

export const authClient = createAuthClient({
	plugins: [
		inferAdditionalFields<typeof auth>(),
		usernameClient(),
		adminClient(),
		organizationClient(),
		twoFactorClient(),
	],
});
