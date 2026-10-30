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

const hasCurrentMembership = async (grant: GrantIdentity) => {
	const membership = await db.query.member.findFirst({
		where: {
			AND: [{ userId: grant.userId }, { organizationId: grant.organizationId }],
		},
		columns: { id: true },
	});

	return Boolean(membership);
};

export const isAuthorizationGrantCurrent = async (grant: AuthorizationGrant) => {
	const membership = hasCurrentMembership(grant);

	if (grant.kind === "api-key") {
		const [apiKey, user, isMember] = await Promise.all([
			db.query.apikey.findFirst({
				where: {
					AND: [
						{ id: grant.apiKeyId },
						{ referenceId: grant.userId },
						{ OR: [{ enabled: true }, { enabled: { isNull: true } }] },
						{ OR: [{ expiresAt: { isNull: true } }, { expiresAt: { gt: new Date() } }] },
					],
				},
				columns: { metadata: true },
			}),
			db.query.usersTable.findFirst({
				where: { id: grant.userId },
				columns: { banned: true },
			}),
			membership,
		]);

		return (
			Boolean(apiKey) &&
			Boolean(user && !user.banned) &&
			isMember &&
			parseApiKeyOrganizationId(apiKey?.metadata) === grant.organizationId
		);
	}

	const [session, isMember] = await Promise.all([
		db.query.sessionsTable.findFirst({
			where: {
				AND: [{ token: grant.token }, { userId: grant.userId }, { expiresAt: { gt: new Date() } }],
			},
			columns: { activeOrganizationId: true, authSource: true },
		}),
		membership,
	]);

	return (
		Boolean(session) &&
		isMember &&
		session?.activeOrganizationId === grant.organizationId &&
		isSessionAuthSourceAllowed(session.authSource) &&
		getSessionAuthSource(session.authSource) === grant.authSource
	);
};
