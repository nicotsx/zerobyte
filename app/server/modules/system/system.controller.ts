import { Hono } from "hono";
import { validator } from "hono-openapi";
import {
	downloadResticPasswordBodySchema,
	downloadResticPasswordDto,
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
import { usersTable } from "../../db/schema";
import { eq } from "drizzle-orm";
import { userHasPassword, verifyUserPassword } from "../auth/helpers";
import { cryptoUtils } from "../../utils/crypto";
import { config } from "~/server/core/config";
import { getOrganizationId } from "~/server/core/request-context";
import {
	createEncryptedOrganizationConfigExport,
	importEncryptedOrganizationConfig,
	isOrganizationConfigEmpty,
} from "./system-config-transfer";

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
			if (c.get("authSource") !== "desktop-session") {
				const hasPassword = await userHasPassword(user.id);
				if (!hasPassword) {
					return c.json({ message: "A local password is required to download the recovery key" }, 403);
				}

				const isPasswordValid = await verifyUserPassword({
					password: body.password,
					userId: user.id,
				});
				if (!isPasswordValid) {
					return c.json({ message: "Invalid password" }, 401);
				}
			}

			try {
				const org = await db.query.organization.findFirst({
					where: { id: organizationId },
				});

				if (!org?.metadata?.resticPassword) {
					return c.json({ message: "Organization Restic password not found" }, 404);
				}

				const content = await cryptoUtils.resolveSecret(org.metadata.resticPassword);

				await db
					.update(usersTable)
					.set({ hasDownloadedResticPassword: true })
					.where(eq(usersTable.id, user.id));

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
	.post("/config-export", requireOrgAdmin, exportConfigDto, async (c) => {
		const organizationId = getOrganizationId();

		try {
			const org = await db.query.organization.findFirst({ where: { id: organizationId } });

			if (!org?.metadata?.resticPassword) {
				return c.json({ message: "Organization Restic password not found" }, 404);
			}

			const resticPassword = await cryptoUtils.resolveSecret(org.metadata.resticPassword);
			const content = await createEncryptedOrganizationConfigExport(organizationId, config.appSecret, resticPassword);

			c.header("Content-Type", "text/plain");
			c.header("Content-Disposition", 'attachment; filename="zerobyte-config.zbex"');

			return c.text(content);
		} catch (_error) {
			return c.json({ message: "Failed to export configuration" }, 500);
		}
	})
	.post("/config-import", requireOrgAdmin, importConfigDto, validator("json", importConfigBodySchema), async (c) => {
		const user = c.get("user");
		const organizationId = getOrganizationId();
		const body = c.req.valid("json");

		if (user.hasDownloadedResticPassword) {
			return c.json({ message: "Configuration import is only available during onboarding" }, 409);
		}

		const isEmpty = await isOrganizationConfigEmpty(organizationId);
		if (!isEmpty) {
			return c.json({ message: "Organization already contains configuration" }, 409);
		}

		try {
			const result = await importEncryptedOrganizationConfig(
				organizationId,
				user.id,
				body.encryptedConfig,
				body.sourceAppSecret,
			);

			return c.json<ImportConfigResponseDto>(
				{
					message:
						result.warnings.length > 0 ? "Configuration imported with warnings" : "Configuration imported successfully",
					imported: result.imported,
					warnings: result.warnings,
				},
				200,
			);
		} catch (_error) {
			return c.json({ message: "Invalid export file or source APP_SECRET" }, 400);
		}
	})
	.get("/dev-panel", getDevPanelDto, async (c) => {
		const enabled = systemService.isDevPanelEnabled();

		return c.json<DevPanelDto>({ enabled }, 200);
	});
