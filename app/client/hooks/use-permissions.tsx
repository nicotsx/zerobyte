import { useSuspenseQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { createContext, type ReactNode, useContext, useMemo } from "react";
import type { Permission, RuntimeFeature } from "~/lib/permission-policy";
import { getCurrentPermissions, getCurrentPermissionsOptions } from "~/server/lib/functions/current-permissions";

type Permissions = {
	can: (permission: Permission) => boolean;
	hasRuntimeFeature: (feature: RuntimeFeature) => boolean;
};

const PermissionsContext = createContext<Permissions | null>(null);

type Props = {
	children: ReactNode;
};

export function PermissionsProvider({ children }: Props) {
	const getPermissions = useServerFn(getCurrentPermissions);
	const { data } = useSuspenseQuery(getCurrentPermissionsOptions(getPermissions));

	const permissions = useMemo<Permissions>(
		() => ({
			can: (permission) => data.permissions[permission],
			hasRuntimeFeature: (feature) => data.features[feature],
		}),
		[data],
	);

	return <PermissionsContext.Provider value={permissions}>{children}</PermissionsContext.Provider>;
}

export function usePermissions() {
	const permissions = useContext(PermissionsContext);

	if (!permissions) {
		throw new Error("usePermissions must be used inside PermissionsProvider");
	}

	return permissions;
}
