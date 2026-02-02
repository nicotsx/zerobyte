import { createAuthClient } from "better-auth/react";
import {
	twoFactorClient,
	usernameClient,
	adminClient,
	organizationClient,
	inferAdditionalFields,
} from "better-auth/client/plugins";
import type { auth } from "~/server/lib/auth";

export const authClient = createAuthClient({
	baseURL: "http://localhost:3000/api/auth",
	plugins: [
		inferAdditionalFields<typeof auth>(),
		usernameClient(),
		adminClient(),
		organizationClient(),
		twoFactorClient(),
	],
});
