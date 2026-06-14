import { createServerFn } from "@tanstack/react-start";
import { getRequestHeaders } from "@tanstack/react-start/server";
import type { Permission, RuntimeFeature } from "~/lib/permission-policy";
import { resolvePermissions } from "~/server/core/request-context";
import { auth } from "~/server/lib/auth";

export const currentPermissionsQueryKey = ["current-permissions"] as const;

export type CurrentPermissions = {
	permissions: Record<Permission, boolean>;
	features: Record<RuntimeFeature, boolean>;
};

export function getCurrentPermissionsOptions(
	queryFn: () => Promise<CurrentPermissions> = () => getCurrentPermissions(),
) {
	return { queryKey: currentPermissionsQueryKey, queryFn };
}

export const getCurrentPermissions = createServerFn({ method: "GET" }).handler(
	async (): Promise<CurrentPermissions> => {
		const headers = getRequestHeaders();
		const [session, activeMember] = await Promise.all([
			auth.api.getSession({ headers }),
			auth.api.getActiveMember({ headers }),
		]);
		const { permissions, features } = resolvePermissions({
			instanceRole: session?.user?.role,
			orgRole: activeMember?.role,
			authSource: session?.user ? ("browser-session" as const) : null,
		});

		return { permissions, features };
	},
);
