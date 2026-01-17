import { relations } from "drizzle-orm";
import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";

export const usersTable = sqliteTable("users_table", {
	id: text("id").primaryKey(),
	name: text("name").notNull(),
	email: text("email").notNull().unique(),
	emailVerified: integer("email_verified", { mode: "boolean" }).default(false).notNull(),
	image: text("image"),
	createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
	updatedAt: integer("updated_at", { mode: "timestamp_ms" })
		.$onUpdate(() => new Date())
		.notNull(),
	username: text("username").notNull(),
	displayUsername: text("display_username"),
	role: text("role"),
	banned: integer("banned", { mode: "boolean" }).default(false),
	banReason: text("ban_reason"),
	banExpires: integer("ban_expires", { mode: "timestamp_ms" }),
	twoFactorEnabled: integer("two_factor_enabled", { mode: "boolean" }).default(false),
	hasDownloadedResticPassword: integer("has_downloaded_restic_password", {
		mode: "boolean",
	}),
});

export const sessionsTable = sqliteTable(
	"sessions_table",
	{
		id: text("id").primaryKey(),
		expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
		token: text("token").notNull().unique(),
		createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
		updatedAt: integer("updated_at", { mode: "timestamp_ms" })
			.$onUpdate(() => new Date())
			.notNull(),
		ipAddress: text("ip_address"),
		userAgent: text("user_agent"),
		userId: text("user_id")
			.notNull()
			.references(() => usersTable.id, { onDelete: "cascade" }),
		impersonatedBy: text("impersonated_by"),
	},
	(table) => [index("sessionsTable_userId_idx").on(table.userId)],
);

export const account = sqliteTable(
	"account",
	{
		id: text("id").primaryKey(),
		accountId: text("account_id").notNull(),
		providerId: text("provider_id").notNull(),
		userId: text("user_id")
			.notNull()
			.references(() => usersTable.id, { onDelete: "cascade" }),
		accessToken: text("access_token"),
		refreshToken: text("refresh_token"),
		idToken: text("id_token"),
		accessTokenExpiresAt: integer("access_token_expires_at", {
			mode: "timestamp_ms",
		}),
		refreshTokenExpiresAt: integer("refresh_token_expires_at", {
			mode: "timestamp_ms",
		}),
		scope: text("scope"),
		password: text("password"),
		createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
		updatedAt: integer("updated_at", { mode: "timestamp_ms" })
			.$onUpdate(() => new Date())
			.notNull(),
	},
	(table) => [index("account_userId_idx").on(table.userId)],
);

export const verification = sqliteTable(
	"verification",
	{
		id: text("id").primaryKey(),
		identifier: text("identifier").notNull(),
		value: text("value").notNull(),
		expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
		createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
		updatedAt: integer("updated_at", { mode: "timestamp_ms" })
			.$onUpdate(() => new Date())
			.notNull(),
	},
	(table) => [index("verification_identifier_idx").on(table.identifier)],
);

export const twoFactor = sqliteTable(
	"two_factor",
	{
		id: text("id").primaryKey(),
		secret: text("secret").notNull(),
		backupCodes: text("backup_codes").notNull(),
		userId: text("user_id")
			.notNull()
			.references(() => usersTable.id, { onDelete: "cascade" }),
	},
	(table) => [index("twoFactor_secret_idx").on(table.secret), index("twoFactor_userId_idx").on(table.userId)],
);

export const ssoProvider = sqliteTable("sso_provider", {
	id: text("id").primaryKey(),
	issuer: text("issuer").notNull(),
	oidcConfig: text("oidc_config"),
	samlConfig: text("saml_config"),
	userId: text("user_id").references(() => usersTable.id, {
		onDelete: "cascade",
	}),
	providerId: text("provider_id").notNull().unique(),
	organizationId: text("organization_id"),
	domain: text("domain").notNull(),
});

export const usersTableRelations = relations(usersTable, ({ many }) => ({
	sessionsTables: many(sessionsTable),
	accounts: many(account),
	twoFactors: many(twoFactor),
	ssoProviders: many(ssoProvider),
}));

export const sessionsTableRelations = relations(sessionsTable, ({ one }) => ({
	usersTable: one(usersTable, {
		fields: [sessionsTable.userId],
		references: [usersTable.id],
	}),
}));

export const accountRelations = relations(account, ({ one }) => ({
	usersTable: one(usersTable, {
		fields: [account.userId],
		references: [usersTable.id],
	}),
}));

export const twoFactorRelations = relations(twoFactor, ({ one }) => ({
	usersTable: one(usersTable, {
		fields: [twoFactor.userId],
		references: [usersTable.id],
	}),
}));

export const ssoProviderRelations = relations(ssoProvider, ({ one }) => ({
	usersTable: one(usersTable, {
		fields: [ssoProvider.userId],
		references: [usersTable.id],
	}),
}));
