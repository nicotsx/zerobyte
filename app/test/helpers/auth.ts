import { auth } from "~/server/lib/auth";

export const COOKIE_PREFIX = "zerobyte";

export function getAuthHeaders(token: string): { Cookie: string } {
	return {
		Cookie: `${COOKIE_PREFIX}.session_token=${token}`,
	};
}

export async function createTestSession() {
	const ctx = await auth.$context;
	const user = ctx.test.createUser();
	await ctx.test.saveUser(user);
	const { headers, session } = await ctx.test.login({ userId: user.id });

	const organizationId = (session as { activeOrganizationId?: string }).activeOrganizationId ?? "";

	return {
		headers: Object.fromEntries(headers.entries()) as Record<string, string>,
		session,
		user,
		organizationId,
	};
}
