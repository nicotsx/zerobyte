import { Hono } from "hono";
import { validator } from "hono-openapi";
import {
	downloadResticPasswordBodySchema,
	downloadResticPasswordDto,
	getUpdatesDto,
	systemInfoDto,
	type SystemInfoDto,
	type UpdateInfoDto,
} from "./system.dto";
import { systemService } from "./system.service";
import { requireAuth, requireOrgAdmin } from "../auth/auth.middleware";
import { db } from "../../db/db";
import { organization, usersTable } from "../../db/schema";
import { eq } from "drizzle-orm";
import { verifyUserPassword } from "../auth/helpers";
import { cryptoUtils } from "../../utils/crypto";

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
	.post(
		"/restic-password",
		requireOrgAdmin,
		downloadResticPasswordDto,
		validator("json", downloadResticPasswordBodySchema),
		async (c) => {
			const user = c.get("user");
			const organizationId = c.get("organizationId");
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
