import { createMiddleware } from "@tanstack/react-start";
import { redirect } from "@tanstack/react-router";
import { auth } from "~/server/lib/auth";
import { getCookie, getRequestHeaders } from "@tanstack/react-start/server";
import { authService } from "~/server/modules/auth/auth.service";
import { isAuthRoute } from "~/lib/auth-routes";
import { RECOVERY_KEY_DOWNLOAD_SKIPPED_COOKIE_NAME } from "~/lib/recovery-key-skip";
import { invalidateAuthSession, isSessionAuthSourceAllowed } from "~/server/modules/auth/helpers";

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
		if (!isSessionAuthSourceAllowed(session.session.authSource)) {
			await invalidateAuthSession(session.session.token);

			throw redirect({ to: "/login" });
		}

		const hasSkippedRecoveryKeyDownload = getCookie(RECOVERY_KEY_DOWNLOAD_SKIPPED_COOKIE_NAME) === session.user.id;

		if (
			!session.user.hasDownloadedResticPassword &&
			!hasSkippedRecoveryKeyDownload &&
			pathname !== "/download-recovery-key"
		) {
			throw redirect({ to: "/download-recovery-key" });
		}

		if (isAuthRoute(pathname)) {
			throw redirect({ to: "/volumes" });
		}
	}

	return next();
});
