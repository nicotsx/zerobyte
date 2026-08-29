import { Hono } from "hono";
import { validator } from "hono-openapi";
import {
	downloadResticPasswordBodySchema,
	downloadResticPasswordDto,
	exportConfigBodySchema,
	exportConfigDto,
	getUpdatesDto,
	systemInfoDto,
	type SystemInfoDto,
	type UpdateInfoDto,
	importConfigBodySchema,
	importConfigDto,
	type ImportConfigResponseDto,
	setRegistrationStatusDto,
	getRegistrationStatusDto,
	registrationStatusBody,
	type RegistrationStatusDto,
	getPasswordLoginStatusDto,
	setPasswordLoginStatusDto,
	passwordLoginStatusBody,
	type PasswordLoginStatusDto,
	getDevPanelDto,
	type DevPanelDto,
} from "./system.dto";
import { systemService } from "./system.service";
import { requireAuth, requireOrgAdmin, requirePermission } from "../auth/auth.middleware";
import { db } from "../../db/db";
import { organization, usersTable } from "../../db/schema";
import { eq } from "drizzle-orm";
import { InternalServerError } from "http-errors-enhanced";
import { userHasPassword, verifyUserPassword } from "../auth/helpers";
import { cryptoUtils } from "../../utils/crypto";
import { getOrganizationId } from "~/server/core/request-context";
import {
	createPassphraseProtectedOrganizationConfigExport,
	OrganizationResticPasswordNotFoundError,
	importConfig,
} from "./config-transfer";

const verifyRecoveryKeyPassword = async (userId: string, password: string, authSource: string) => {
	if (authSource === "desktop-session") {
		return null;
	}

	const hasPassword = await userHasPassword(userId);
	if (!hasPassword) {
		return { message: "A local password is required to download the recovery key", status: 403 as const };
	}

	const isPasswordValid = await verifyUserPassword({ password, userId });
	if (!isPasswordValid) {
		return { message: "Invalid password", status: 401 as const };
	}

	return null;
};

const recordRecoveryMaterialDownload = (organizationId: string, userId: string) => {
	const recoveryMaterialExportedAt = new Date();
	db.transaction((tx) => {
		tx.update(organization).set({ recoveryMaterialExportedAt }).where(eq(organization.id, organizationId)).run();
		tx.update(usersTable).set({ hasDownloadedResticPassword: true }).where(eq(usersTable.id, userId)).run();
	});
};

export const systemController = new Hono()
	.use(requireAuth)
	.get("/info", systemInfoDto, async (c) => {
		const info = await systemService.getSystemInfo();

		return c.json<SystemInfoDto>(info, 200);
	})
	.get("/updates", getUpdatesDto, async (c) => {
		const updates = await systemService.getUpdates();
		c.header("Cache-Control", "no-store");

		return c.json<UpdateInfoDto>(updates, 200);
	})
	.get("/registration-status", getRegistrationStatusDto, async (c) => {
		const enabled = await systemService.isRegistrationEnabled();

		return c.json<RegistrationStatusDto>({ enabled }, 200);
	})
	.put(
		"/registration-status",
		requirePermission("registration.manage"),
		setRegistrationStatusDto,
		validator("json", registrationStatusBody),
		async (c) => {
			const body = c.req.valid("json");

			await systemService.setRegistrationEnabled(body.enabled);

			return c.json<RegistrationStatusDto>({ enabled: body.enabled }, 200);
		},
	)
	.post(
		"/restic-password",
		requirePermission("recoveryKey.download"),
		downloadResticPasswordDto,
		validator("json", downloadResticPasswordBodySchema),
		async (c) => {
			const user = c.get("user");
			const organizationId = getOrganizationId();
			const body = c.req.valid("json");
			const passwordError = await verifyRecoveryKeyPassword(user.id, body.password, c.get("authSource"));
			if (passwordError) {
				return c.json({ message: passwordError.message }, passwordError.status);
			}

			try {
				const org = await db.query.organization.findFirst({
					where: { id: organizationId },
				});

				if (!org?.metadata?.resticPassword) {
					return c.json({ message: "Organization Restic password not found" }, 404);
				}

				const content = await cryptoUtils.resolveSecret(org.metadata.resticPassword);

				recordRecoveryMaterialDownload(organizationId, user.id);

				c.header("Content-Type", "text/plain");
				c.header("Content-Disposition", 'attachment; filename="restic.pass"');

				return c.text(content);
			} catch (_error) {
				return c.json({ message: "Failed to retrieve Restic password" }, 500);
			}
		},
	)
	.get("/password-login-status", getPasswordLoginStatusDto, async (c) => {
		const disabled = await systemService.isPasswordLoginDisabled();

		return c.json<PasswordLoginStatusDto>({ disabled }, 200);
	})
	.put(
		"/password-login-status",
		requirePermission("passwordLogin.manage"),
		setPasswordLoginStatusDto,
		validator("json", passwordLoginStatusBody),
		async (c) => {
			const body = c.req.valid("json");

			await systemService.setPasswordLoginDisabled(body.disabled);

			return c.json<PasswordLoginStatusDto>({ disabled: body.disabled }, 200);
		},
	)
	.post(
		"/config-export",
		requirePermission("recoveryKey.download"),
		exportConfigDto,
		validator("json", exportConfigBodySchema),
		async (c) => {
			const user = c.get("user");
			const organizationId = getOrganizationId();
			const body = c.req.valid("json");
			const passwordError = await verifyRecoveryKeyPassword(user.id, body.password, c.get("authSource"));
			if (passwordError) {
				return c.json({ message: passwordError.message }, passwordError.status);
			}

			let content: string;
			try {
				content = await createPassphraseProtectedOrganizationConfigExport(
					organizationId,
					body.exportPassphrase,
				);
			} catch (cause) {
				if (cause instanceof OrganizationResticPasswordNotFoundError) {
					return c.json({ message: cause.message }, 404);
				}

				throw new InternalServerError("Failed to export configuration", { cause });
			}

			recordRecoveryMaterialDownload(organizationId, user.id);

			c.header("Content-Type", "text/plain");
			c.header("Content-Disposition", 'attachment; filename="zerobyte-config.zbex"');

			return c.text(content);
		},
	)
	.post("/config-import", requireOrgAdmin, importConfigDto, validator("json", importConfigBodySchema), async (c) => {
		const user = c.get("user");
		const organizationId = getOrganizationId();
		const body = c.req.valid("json");

		const result = await importConfig(organizationId, user.id, body.encryptedConfig, body.exportPassphrase);

		return c.json<ImportConfigResponseDto>(
			{
				imported: result.imported,
				warnings: result.warnings,
			},
			200,
		);
	})
	.get("/dev-panel", getDevPanelDto, async (c) => {
		const enabled = systemService.isDevPanelEnabled();

		return c.json<DevPanelDto>({ enabled }, 200);
	});
