import { createFileRoute, redirect } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { getCookie, getRequestHeaders } from "@tanstack/react-start/server";
import { Layout } from "~/client/components/layout";
import { SIDEBAR_COOKIE_NAME } from "~/client/components/ui/sidebar";
import { authMiddleware } from "~/middleware/auth";
import { auth } from "~/server/lib/auth";
import { getCurrentPermissionsOptions } from "~/server/lib/functions/current-permissions";
import { getOrganizationContext } from "~/server/lib/functions/organization-context";
import { getServerConstants } from "~/server/lib/functions/server-constants";
import { userHasCredentialPassword } from "~/server/modules/auth/helpers";
import { authService } from "~/server/modules/auth/auth.service";
import { RECOVERY_KEY_DOWNLOAD_SKIPPED_COOKIE_NAME } from "~/lib/recovery-key-skip";

export const fetchUser = createServerFn({ method: "GET" }).handler(async () => {
	const headers = getRequestHeaders();
	const session = await auth.api.getSession({ headers });
	const hasUsers = await authService.hasUsers();
	const hasCredentialPassword = session?.user ? await userHasCredentialPassword(session.user.id) : false;

	const sidebarCookie = getCookie(SIDEBAR_COOKIE_NAME);
	const sidebarOpen = !sidebarCookie ? true : sidebarCookie === "true";
	const hasSkippedRecoveryKeyDownload =
		!!session?.user && getCookie(RECOVERY_KEY_DOWNLOAD_SKIPPED_COOKIE_NAME) === session.user.id;

	return {
		user: session?.user ? { ...session.user, hasCredentialPassword } : null,
		hasUsers,
		sidebarOpen,
		hasSkippedRecoveryKeyDownload,
	};
});

export const Route = createFileRoute("/(dashboard)")({
	component: PathlessLayoutComponent,
	errorComponent: (e) => <div>{e.error.message}</div>,
	server: {
		middleware: [authMiddleware],
	},
	beforeLoad: async ({ context }) => context.queryClient.fetchQuery(getCurrentPermissionsOptions()),
	loader: async ({ context }) => {
		const [authContext] = await Promise.all([
			fetchUser(),
			context.queryClient.ensureQueryData({
				queryKey: ["organization-context"],
				queryFn: () => getOrganizationContext(),
			}),
			context.queryClient.ensureQueryData({
				queryKey: ["server-constants"],
				queryFn: () => getServerConstants(),
			}),
		]);

		if (
			authContext.user &&
			!authContext.user.hasDownloadedResticPassword &&
			!authContext.hasSkippedRecoveryKeyDownload
		) {
			throw redirect({ to: "/download-recovery-key" });
		}

		return authContext;
	},
});

function PathlessLayoutComponent() {
	const loaderData = Route.useLoaderData();

	return <Layout loaderData={loaderData} />;
}
