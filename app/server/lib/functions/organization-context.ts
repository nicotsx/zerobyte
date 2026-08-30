import { createServerFn } from "@tanstack/react-start";
import { auth } from "../auth";
import { getRequest } from "@tanstack/react-start/server";
import { db } from "~/server/db/db";

export const getOrganizationContext = createServerFn({ method: "GET" }).handler(async () => {
	const request = getRequest();

	const [data, session] = await Promise.all([
		auth.api.listOrganizations({
			headers: request.headers,
		}),
		auth.api.getSession({ headers: request.headers }),
	]);

	if (data.length === 0) {
		throw new Error("No organizations found for user");
	}

	const activeOrganizationId = session?.session?.activeOrganizationId;
	const fallbackOrganization = data.at(0);
	if (!fallbackOrganization) {
		throw new Error("No organizations found for user");
	}

	const selectedOrganization = data.find((org) => org.id === activeOrganizationId) ?? fallbackOrganization;
	const organizationRecord = await db.query.organization.findFirst({
		where: { id: selectedOrganization.id },
		columns: { createdAt: true, recoveryKeyExportedAt: true },
	});
	const createdAt = organizationRecord?.createdAt ?? selectedOrganization.createdAt;
	const recoveryKeyExportedAt = organizationRecord?.recoveryKeyExportedAt ?? null;
	const activeOrganization = { ...selectedOrganization, createdAt, recoveryKeyExportedAt };

	const member = await auth.api.getActiveMember({
		headers: request.headers,
	});

	return {
		organizations: data,
		activeOrganization,
		activeMember: member,
	};
});
