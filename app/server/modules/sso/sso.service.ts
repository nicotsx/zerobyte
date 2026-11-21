import { db } from "~/server/db/db";
import { ssoProvider, account, invitation, organization, sessionsTable, verification } from "~/server/db/schema";
import { eq, and, inArray, gt } from "drizzle-orm";
import { isReservedSsoProviderId } from "./utils/sso-provider-id";
import { normalizeEmail } from "./utils/sso-context";
import { parse as parseCookie } from "hono/utils/cookie";
import { z } from "zod";

export const SSO_INVITATION_INTENT_COOKIE = "zerobyte.sso_invitation_intent";
const SSO_INVITATION_INTENT_PREFIX = "sso-invitation-accept";
const SSO_INVITATION_INTENT_TTL_MS = 10 * 60 * 1000;

const ssoInvitationIntentSchema = z
	.object({
		userId: z.string(),
		invitationId: z.string(),
		providerId: z.string(),
		organizationId: z.string(),
		email: z.string(),
	})
	.transform((intent) => ({ ...intent, email: normalizeEmail(intent.email) }));

const ssoInvitationIntentRecordSchema = z
	.string()
	.transform((value, ctx) => {
		try {
			return JSON.parse(value) as unknown;
		} catch {
			ctx.addIssue({
				code: "custom",
				message: "Invalid SSO invitation intent",
			});
			return z.NEVER;
		}
	})
	.pipe(ssoInvitationIntentSchema);

type SsoInvitationIntent = z.infer<typeof ssoInvitationIntentSchema>;

function getIntentIdentifier(token: string) {
	return `${SSO_INVITATION_INTENT_PREFIX}:${token}`;
}

function parseSsoInvitationIntent(value: string): SsoInvitationIntent | null {
	const parsed = ssoInvitationIntentRecordSchema.safeParse(value);
	return parsed.success ? parsed.data : null;
}

class SsoService {
	/**
	 * Get public SSO providers for the instance
	 */
	async getPublicSsoProviders() {
		const providers = await db
			.select({
				providerId: ssoProvider.providerId,
				organizationSlug: organization.slug,
			})
			.from(ssoProvider)
			.innerJoin(organization, eq(ssoProvider.organizationId, organization.id));

		return { providers };
	}

	async getSsoProviderById(providerId: string) {
		return db.query.ssoProvider.findFirst({
			where: { providerId },
			columns: { id: true, providerId: true, organizationId: true },
		});
	}

	/**
	 * Get an active pending invitation for organization/email
	 */
	async getPendingInvitation(organizationId: string, email: string) {
		return db.query.invitation.findFirst({
			where: {
				AND: [
					{ organizationId },
					{ status: "pending" },
					{ expiresAt: { gt: new Date() } },
					{ email: normalizeEmail(email) },
				],
			},
			columns: {
				id: true,
				email: true,
				role: true,
				organizationId: true,
			},
		});
	}

	async listPendingInvitationsForUser(email: string) {
		const normalizedEmail = normalizeEmail(email);
		const pendingInvitations = await db
			.select({
				id: invitation.id,
				organizationId: invitation.organizationId,
				organizationName: organization.name,
				role: invitation.role,
				expiresAt: invitation.expiresAt,
			})
			.from(invitation)
			.innerJoin(organization, eq(invitation.organizationId, organization.id))
			.where(
				and(
					eq(invitation.email, normalizedEmail),
					eq(invitation.status, "pending"),
					gt(invitation.expiresAt, new Date()),
				),
			);

		const organizationIds = [...new Set(pendingInvitations.map((row) => row.organizationId))];
		const providers =
			organizationIds.length > 0
				? await db.query.ssoProvider.findMany({
						columns: { providerId: true, organizationId: true },
						where: { organizationId: { in: organizationIds } },
					})
				: [];

		return pendingInvitations.map((pendingInvitation) => ({
			id: pendingInvitation.id,
			organizationName: pendingInvitation.organizationName,
			role: pendingInvitation.role ?? "member",
			expiresAt: pendingInvitation.expiresAt.toISOString(),
			ssoProviders: providers
				.filter((provider) => provider.organizationId === pendingInvitation.organizationId)
				.map((provider) => ({ providerId: provider.providerId })),
		}));
	}

	async getPendingInvitationById(invitationId: string) {
		return db.query.invitation.findFirst({
			where: {
				AND: [{ id: invitationId }, { status: "pending" }, { expiresAt: { gt: new Date() } }],
			},
			columns: {
				id: true,
				email: true,
				role: true,
				organizationId: true,
			},
		});
	}

	async listAccountLinkProviders(userId: string, organizationId: string) {
		const [providers, accounts] = await Promise.all([
			db.query.ssoProvider.findMany({
				where: { AND: [{ organizationId }, { oidcConfig: { isNotNull: true } }] },
				columns: { providerId: true, issuer: true },
				orderBy: { providerId: "asc" },
			}),
			db.query.account.findMany({ where: { userId }, columns: { providerId: true } }),
		]);

		const linkedProviderIds = new Set(accounts.map((entry) => entry.providerId));
		return providers.map((provider) => ({
			...provider,
			linked: linkedProviderIds.has(provider.providerId),
		}));
	}

	async getSsoProviderForOrganization(providerId: string, organizationId: string) {
		return db.query.ssoProvider.findFirst({
			where: { AND: [{ providerId }, { organizationId }] },
			columns: { providerId: true, organizationId: true },
		});
	}

	getInvitationIntentTokenFromRequest(request?: Request | null) {
		if (!request) {
			return null;
		}

		return parseCookie(request.headers.get("cookie") ?? "", SSO_INVITATION_INTENT_COOKIE)[
			SSO_INVITATION_INTENT_COOKIE
		];
	}

	async createInvitationSsoIntent(intent: SsoInvitationIntent) {
		const token = crypto.randomUUID();
		await db.insert(verification).values({
			id: Bun.randomUUIDv7(),
			identifier: getIntentIdentifier(token),
			value: JSON.stringify({ ...intent, email: normalizeEmail(intent.email) }),
			expiresAt: new Date(Date.now() + SSO_INVITATION_INTENT_TTL_MS),
		});

		return token;
	}

	async getValidInvitationSsoIntent(token: string | null | undefined) {
		if (!token) {
			return null;
		}

		const record = await db.query.verification.findFirst({
			where: { AND: [{ identifier: getIntentIdentifier(token) }, { expiresAt: { gt: new Date() } }] },
			columns: { value: true },
		});

		if (!record) {
			return null;
		}

		return parseSsoInvitationIntent(record.value);
	}

	async consumeInvitationSsoIntent(token: string | null | undefined) {
		if (!token) {
			return;
		}

		await db.delete(verification).where(eq(verification.identifier, getIntentIdentifier(token)));
	}

	/**
	 * Delete an SSO provider and its associated accounts
	 */
	async deleteSsoProvider(providerId: string, organizationId: string) {
		return db.transaction((tx) => {
			const provider = tx.query.ssoProvider
				.findFirst({
					where: { AND: [{ providerId }, { organizationId }] },
					columns: { id: true, providerId: true },
				})
				.sync();

			if (!provider) {
				return false;
			}

			if (isReservedSsoProviderId(provider.providerId)) {
				tx.delete(ssoProvider).where(eq(ssoProvider.id, provider.id)).run();
				return true;
			}

			const affectedAccounts = tx.query.account
				.findMany({
					where: { providerId: provider.providerId },
					columns: { userId: true },
				})
				.sync();
			const affectedUserIds = [...new Set(affectedAccounts.map((row) => row.userId))];

			tx.delete(account).where(eq(account.providerId, provider.providerId)).run();
			tx.delete(ssoProvider).where(eq(ssoProvider.id, provider.id)).run();

			if (affectedUserIds.length > 0) {
				tx.delete(sessionsTable).where(inArray(sessionsTable.userId, affectedUserIds)).run();
			}

			return true;
		});
	}

	/**
	 * Get an SSO invitation by ID
	 */
	async getSsoInvitationById(invitationId: string) {
		return db.query.invitation.findFirst({
			where: { id: invitationId },
			columns: { id: true, organizationId: true },
		});
	}

	/**
	 * Delete an invitation
	 */
	async deleteSsoInvitation(invitationId: string) {
		await db.delete(invitation).where(eq(invitation.id, invitationId));
	}
}

export const ssoService = new SsoService();
