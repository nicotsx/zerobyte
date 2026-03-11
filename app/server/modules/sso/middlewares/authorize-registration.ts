import { APIError } from "better-auth/api";
import type { AuthMiddlewareContext } from "~/server/lib/auth";
import { db } from "~/server/db/db";

export const authorizeSsoRegistration = async (ctx: AuthMiddlewareContext) => {
	if (ctx.path !== "/sso/register") {
		return;
	}

	const sessionToken = await ctx.getSignedCookie(ctx.context.authCookies.sessionToken.name, ctx.context.secret);
	if (!sessionToken) {
		throw new APIError("UNAUTHORIZED");
	}

	const session = await ctx.context.internalAdapter.findSession(sessionToken);
	if (!session || session.session.expiresAt < new Date()) {
		throw new APIError("UNAUTHORIZED");
	}

	ctx.context.session = session;

	if (!ctx.body || typeof ctx.body !== "object") {
		throw new APIError("BAD_REQUEST", { message: "Missing SSO registration payload" });
	}

	const organizationId = (ctx.body as Record<string, unknown>).organizationId;
	if (typeof organizationId !== "string" || organizationId.length === 0) {
		throw new APIError("BAD_REQUEST", { message: "organizationId is required to register an SSO provider" });
	}

	const membership = await db.query.member.findFirst({
		where: {
			AND: [{ userId: session.user.id }, { organizationId }],
		},
		columns: { role: true },
	});

	if (!membership) {
		throw new APIError("FORBIDDEN", { message: "You are not a member of this organization" });
	}

	if (membership.role !== "owner") {
		throw new APIError("FORBIDDEN", { message: "Only organization owners can register SSO providers" });
	}
};
