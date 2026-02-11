import { createMiddleware } from "@tanstack/react-start";
import { redirect } from "@tanstack/react-router";
import { auth } from "~/server/lib/auth";
import { getRequestHeaders } from "@tanstack/react-start/server";
import { authService } from "~/server/modules/auth/auth.service";

export const authMiddleware = createMiddleware().server(async ({ next, request }) => {
	const headers = getRequestHeaders();
	const session = await auth.api.getSession({ headers });

	const isAuthRoute = ["/login", "/onboarding"].includes(new URL(request.url).pathname);

	if (!session?.user?.id && !isAuthRoute) {
		const hasUsers = await authService.hasUsers();
		if (!hasUsers) {
			throw redirect({ to: "/onboarding" });
		}

		throw redirect({ to: "/login" });
	}

	if (session?.user?.id) {
		if (isAuthRoute) {
			throw redirect({ to: "/" });
		}
	}

	return next();
});
