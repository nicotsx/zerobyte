import { Hono } from "hono";
import { validator } from "hono-openapi";
import {
	downloadResticPasswordBodySchema,
	downloadResticPasswordDto,
	getUpdatesDto,
	systemInfoDto,
	type SystemInfoDto,
	type UpdateInfoDto,
	setRegistrationStatusDto,
	getRegistrationStatusDto,
	registrationStatusBody,
	type RegistrationStatusDto,
} from "./system.dto";
import { systemService } from "./system.service";
import { requireAuth, requireOrgAdmin } from "../auth/auth.middleware";
import { db } from "../../db/db";
import { organization, usersTable } from "../../db/schema";
import { eq } from "drizzle-orm";
import { verifyUserPassword } from "../auth/helpers";
import { cryptoUtils } from "../../utils/crypto";
import { createMiddleware } from "hono/factory";
import { getOrganizationId } from "~/server/core/request-context";

const requireGlobalAdmin = createMiddleware(async (c, next) => {
	const user = c.get("user");

	if (!user || user.role !== "admin") {
		return c.json({ message: "Forbidden" }, 403);
	}

	await next();
});

export const systemController = new Hono()
	.use(requireAuth)
	.get("/info", systemInfoDto, async (c) => {
		const info = await systemService.getSystemInfo();

		return c.json<SystemInfoDto>(info, 200);
	})
	.get("/updates", getUpdatesDto, async (c) => {
		const updates = await systemService.getUpdates();

		return c.json<UpdateInfoDto>(updates, 200);
	})
	.get("/registration-status", getRegistrationStatusDto, async (c) => {
		const enabled = await systemService.isRegistrationEnabled();

		return c.json<RegistrationStatusDto>({ enabled }, 200);
	})
	.put(
		"/registration-status",
		requireGlobalAdmin,
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
		requireOrgAdmin,
		downloadResticPasswordDto,
		validator("json", downloadResticPasswordBodySchema),
		async (c) => {
			const user = c.get("user");
			const organizationId = getOrganizationId();
			const body = c.req.valid("json");

			const isPasswordValid = await verifyUserPassword({ password: body.password, userId: user.id });
			if (!isPasswordValid) {
				return c.json({ message: "Invalid password" }, 401);
			}

			try {
				const org = await db.query.organization.findFirst({
					where: eq(organization.id, organizationId),
				});

				if (!org?.metadata?.resticPassword) {
					return c.json({ message: "Organization Restic password not found" }, 404);
				}

				const content = await cryptoUtils.resolveSecret(org.metadata.resticPassword);

				await db.update(usersTable).set({ hasDownloadedResticPassword: true }).where(eq(usersTable.id, user.id));

				c.header("Content-Type", "text/plain");
				c.header("Content-Disposition", 'attachment; filename="restic.pass"');

				return c.text(content);
			} catch (_error) {
				return c.json({ message: "Failed to retrieve Restic password" }, 500);
			}
		},
	);
