import { createMiddleware } from "@tanstack/react-start";
import { redirect } from "@tanstack/react-router";
import { auth } from "~/server/lib/auth";
import { getRequestHeaders } from "@tanstack/react-start/server";
import { authService } from "~/server/modules/auth/auth.service";

function isAuthRoute(pathname: string): boolean {
	if (pathname === "/onboarding") return true;
	if (pathname === "/login") return true;
	if (pathname.match(/^\/login\/[^/]+$/)) return true;
	if (pathname.match(/^\/login\/[^/]+\/error$/)) return true;
	return false;
}

export const authMiddleware = createMiddleware().server(async ({ next, request }) => {
	const headers = getRequestHeaders();
	const session = await auth.api.getSession({ headers });
	const pathname = new URL(request.url).pathname;

	if (!session?.user?.id && !isAuthRoute(pathname)) {
		const hasUsers = await authService.hasUsers();
		if (!hasUsers) {
			throw redirect({ to: "/onboarding" });
		}

		throw redirect({ to: "/login" });
	}

	if (session?.user?.id) {
		if (!session.user.hasDownloadedResticPassword && pathname !== "/download-recovery-key") {
			throw redirect({ to: "/download-recovery-key" });
		}

		if (isAuthRoute(pathname)) {
			throw redirect({ to: "/volumes" });
		}
	}

	return next();
});
