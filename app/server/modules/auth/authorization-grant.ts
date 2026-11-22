import type { AuthSource } from "~/lib/permission-policy";
import { db } from "~/server/db/db";
import { parseApiKeyOrganizationId } from "../api-keys/api-key-metadata";
import { getSessionAuthSource, isSessionAuthSourceAllowed } from "./helpers";

type GrantIdentity = {
	userId: string;
	organizationId: string;
};

export type AuthorizationGrant = GrantIdentity &
	(
		| { kind: "api-key"; apiKeyId: string }
		| { kind: "session"; token: string; authSource: Exclude<AuthSource, "api-key"> }
	);

export const getCurrentAuthorizationMembership = (grant: AuthorizationGrant, database: Pick<typeof db, "query">) => {
	const membership = database.query.member
		.findFirst({
			where: {
				AND: [{ userId: grant.userId }, { organizationId: grant.organizationId }],
			},
			columns: { role: true },
		})
		.sync();
	if (!membership) return null;

	if (grant.kind === "api-key") {
		const apiKey = database.query.apikey
			.findFirst({
				where: {
					AND: [
						{ id: grant.apiKeyId },
						{ referenceId: grant.userId },
						{ OR: [{ enabled: true }, { enabled: { isNull: true } }] },
						{ OR: [{ expiresAt: { isNull: true } }, { expiresAt: { gt: new Date() } }] },
					],
				},
				columns: { metadata: true },
			})
			.sync();

		if (!apiKey || parseApiKeyOrganizationId(apiKey.metadata) !== grant.organizationId) return null;

		const user = database.query.usersTable
			.findFirst({
				where: { id: grant.userId },
				columns: { banned: true },
			})
			.sync();

		return user && !user.banned ? membership : null;
	}

	const session = database.query.sessionsTable
		.findFirst({
			where: {
				AND: [{ token: grant.token }, { userId: grant.userId }, { expiresAt: { gt: new Date() } }],
			},
			columns: { activeOrganizationId: true, authSource: true },
		})
		.sync();

	if (
		session?.activeOrganizationId !== grant.organizationId ||
		!isSessionAuthSourceAllowed(session.authSource) ||
		getSessionAuthSource(session.authSource) !== grant.authSource
	) {
		return null;
	}

	return membership;
};

export const isAuthorizationGrantCurrent = async (grant: AuthorizationGrant) =>
	getCurrentAuthorizationMembership(grant, db) !== null;
