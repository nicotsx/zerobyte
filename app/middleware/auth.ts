import { redirect, type MiddlewareFunction } from "react-router";
import { getStatus } from "~/client/api-client";
import { authClient } from "~/client/lib/auth-client";
import { appContext } from "~/context";

export const authMiddleware: MiddlewareFunction = async ({ context, request }) => {
	const { data: session } = await authClient.getSession();

	const isAuthRoute = ["/login", "/onboarding"].includes(new URL(request.url).pathname);

	if (!session?.user?.id && !isAuthRoute) {
		const status = await getStatus();
		if (!status.data?.hasUsers) {
			throw redirect("/onboarding");
		}

		throw redirect("/login");
	}

	if (session?.user?.id) {
		context.set(appContext, { user: session.user, hasUsers: true });

		if (isAuthRoute) {
			throw redirect("/");
		}
	}
};
