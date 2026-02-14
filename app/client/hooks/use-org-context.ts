import { useSuspenseQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getOrganizationContext } from "~/server/lib/functions/organization-context";

export function useOrganizationContext() {
	const getOrgContext = useServerFn(getOrganizationContext);
	const { data } = useSuspenseQuery({
		queryKey: ["organization-context"],
		queryFn: getOrgContext,
	});

	return data;
}
