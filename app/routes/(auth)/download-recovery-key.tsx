import { createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { getRequestHeaders } from "@tanstack/react-start/server";
import { DownloadRecoveryKeyPage } from "~/client/modules/auth/routes/download-recovery-key";
import { auth } from "~/server/lib/auth";
import { isPasswordAuthSupported, userHasPassword } from "~/server/modules/auth/helpers";

const getRecoveryKeyUserState = createServerFn({ method: "GET" }).handler(async () => {
	const headers = getRequestHeaders();
	const session = await auth.api.getSession({ headers });
	const passwordAuthSupported = isPasswordAuthSupported(session?.session.authSource);

	return {
		passwordAuthSupported,
		hasPassword: passwordAuthSupported && session?.user ? await userHasPassword(session.user.id) : false,
		userId: session?.user.id ?? null,
	};
});

export const Route = createFileRoute("/(auth)/download-recovery-key")({
	component: RouteComponent,
	errorComponent: () => <div>Failed to load recovery key</div>,
	loader: async () => getRecoveryKeyUserState(),
	head: () => ({
		meta: [
			{ title: "Zerobyte - Download Recovery Key" },
			{
				name: "description",
				content: "Download your backup recovery key to ensure you can restore your data.",
			},
		],
	}),
});

function RouteComponent() {
	const { passwordAuthSupported, hasPassword, userId } = Route.useLoaderData();

	return (
		<DownloadRecoveryKeyPage
			passwordAuthSupported={passwordAuthSupported}
			hasPassword={hasPassword}
			userId={userId}
		/>
	);
}
