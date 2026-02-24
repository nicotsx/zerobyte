import { createServerFn } from "@tanstack/react-start";
import { auth } from "../auth";
import { getRequest } from "@tanstack/react-start/server";

export const getOrganizationContext = createServerFn({ method: "GET" }).handler(async () => {
	const request = getRequest();

	const [data, session] = await Promise.all([
		auth.api.listOrganizations({
			headers: request.headers,
		}),
		auth.api.getSession({ headers: request.headers }),
	]);

	const activeOrganizationId = session?.session?.activeOrganizationId;
	const activeOrganization = data.find((org) => org.id === activeOrganizationId);

	if (data.length === 0) {
		throw new Error("No organizations found for user");
	}

	const member = await auth.api.getActiveMember({
		headers: request.headers,
	});

	return {
		organizations: data,
		activeOrganization: activeOrganization || data[0],
		activeMember: member,
	};
});
