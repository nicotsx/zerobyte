import { AsyncLocalStorage } from "node:async_hooks";
import type { Account, GenericEndpointContext } from "better-auth";
import { addOAuthServerContext, APIError, getOAuthState } from "better-auth/api";
import { and, eq, gt } from "drizzle-orm";
import { z } from "zod";
import { ACCOUNT_LINK_REQUIRED_DESCRIPTION } from "~/lib/sso-errors";
import { db } from "~/server/db/db";
import { account, verification } from "~/server/db/schema";
import { getSsoProviderIdentity } from "./sso-configuration";
import { normalizeEmail } from "./utils/sso-context";

export const SSO_ACCOUNT_LINK_RETURN_PATH = "/settings?scope=personal";

const STATE_KEY = "zerobyteAccountLink";
const INTENT_IDENTIFIER = "sso-account-link";
const INTENT_TTL_MS = 10 * 60 * 1000;

const accountLinkSchema = z.object({
	id: z.string(),
	userId: z.string(),
	email: z.string(),
	sessionId: z.string(),
	organizationId: z.string(),
	providerId: z.string(),
	providerIdentity: z.object({
		id: z.string(),
		issuer: z.string(),
		clientId: z.string(),
		discoveryEndpoint: z.string(),
	}),
});

type SsoAccountLink = z.infer<typeof accountLinkSchema>;

const pendingLink = new AsyncLocalStorage<SsoAccountLink>();

export async function startSsoAccountLink<T>(
	link: Omit<SsoAccountLink, "id" | "providerIdentity">,
	signIn: () => Promise<T>,
): Promise<T | null> {
	const providerIdentity = getSsoProviderIdentity(link.providerId, link.organizationId);
	if (!providerIdentity) return null;

	const existingAccount = db.query.account
		.findFirst({
			where: { userId: link.userId, providerId: link.providerId },
			columns: { id: true },
		})
		.sync();
	if (existingAccount) return null;

	const id = Bun.randomUUIDv7();
	await db.insert(verification).values({
		id,
		identifier: INTENT_IDENTIFIER,
		value: link.userId,
		expiresAt: new Date(Date.now() + INTENT_TTL_MS),
	});

	return pendingLink.run({ ...link, id, providerIdentity }, signIn);
}

export async function attachSsoAccountLink(ctx: GenericEndpointContext) {
	if (ctx.path !== "/sign-in/sso") return;

	const link = pendingLink.getStore();
	if (link) await addOAuthServerContext({ [STATE_KEY]: link });
}

export function accountLinkRequired() {
	return new APIError("FORBIDDEN", {
		code: "ACCOUNT_LINK_REQUIRED",
		message: ACCOUNT_LINK_REQUIRED_DESCRIPTION,
	});
}

export async function getSsoAccountLink() {
	const state = await getOAuthState();
	const link = state?.serverContext?.[STATE_KEY];
	if (link === undefined) return null;

	const result = accountLinkSchema.safeParse(link);
	if (!result.success) throw accountLinkRequired();

	return result.data;
}

export function saveSsoAccountLink(link: SsoAccountLink, binding: Omit<Account, "id">, sessionToken: string) {
	if (binding.userId !== link.userId || binding.providerId !== link.providerId) throw accountLinkRequired();

	db.transaction(
		(tx) => {
			const now = new Date();
			const session = tx.query.sessionsTable
				.findFirst({
					where: {
						id: link.sessionId,
						token: sessionToken,
						userId: link.userId,
						activeOrganizationId: link.organizationId,
						expiresAt: { gt: now },
						impersonatedBy: { isNull: true },
					},
					columns: { id: true },
					with: { user: { columns: { email: true, banned: true } } },
				})
				.sync();

			if (!session?.user || session.user.banned || normalizeEmail(session.user.email) !== link.email) {
				throw accountLinkRequired();
			}

			const membership = tx.query.member
				.findFirst({
					where: { userId: link.userId, organizationId: link.organizationId },
					columns: { id: true },
				})
				.sync();
			if (!membership) throw accountLinkRequired();

			const provider = getSsoProviderIdentity(link.providerId, link.organizationId, tx.query);
			if (
				!provider ||
				provider.id !== link.providerIdentity.id ||
				provider.issuer !== link.providerIdentity.issuer ||
				provider.discoveryEndpoint !== link.providerIdentity.discoveryEndpoint ||
				provider.clientId !== link.providerIdentity.clientId
			) {
				throw accountLinkRequired();
			}

			const existingAccount = tx.query.account
				.findFirst({
					where: {
						providerId: binding.providerId,
						OR: [{ accountId: binding.accountId }, { userId: binding.userId }],
					},
					columns: { id: true },
				})
				.sync();

			if (existingAccount) throw accountLinkRequired();

			const [consumed] = tx
				.delete(verification)
				.where(
					and(
						eq(verification.id, link.id),
						eq(verification.identifier, INTENT_IDENTIFIER),
						eq(verification.value, link.userId),
						gt(verification.expiresAt, now),
					),
				)
				.returning({ id: verification.id })
				.all();

			if (!consumed) throw accountLinkRequired();

			tx.insert(account)
				.values({ ...binding, id: Bun.randomUUIDv7() })
				.run();
		},
		{ behavior: "immediate" },
	);
}

export async function completeSsoAccountLink(
	ctx: GenericEndpointContext,
	link: SsoAccountLink,
	binding: Omit<Account, "id">,
): Promise<never> {
	const token = await ctx.getSignedCookie(ctx.context.authCookies.sessionToken.name, ctx.context.secret);
	if (!token) throw accountLinkRequired();

	saveSsoAccountLink(link, binding, token);

	// End the OAuth callback here to preserve the browser session that authorized the link.
	throw ctx.redirect(SSO_ACCOUNT_LINK_RETURN_PATH);
}
