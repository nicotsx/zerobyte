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
import { requireAuth } from "../auth/auth.middleware";
import { RESTIC_PASS_FILE } from "../../core/constants";
import { db } from "../../db/db";
import { usersTable } from "../../db/schema";
import { eq } from "drizzle-orm";
import { verifyUserPassword } from "../auth/helpers";

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
		downloadResticPasswordDto,
		validator("json", downloadResticPasswordBodySchema),
		async (c) => {
			const user = c.get("user");
			const body = c.req.valid("json");

			const isPasswordValid = await verifyUserPassword({ password: body.password, userId: user.id });
			if (!isPasswordValid) {
				return c.json({ message: "Invalid password" }, 401);
			}

			try {
				const file = Bun.file(RESTIC_PASS_FILE);
				const content = await file.text();

				await db.update(usersTable).set({ hasDownloadedResticPassword: true }).where(eq(usersTable.id, user.id));

				c.header("Content-Type", "text/plain");
				c.header("Content-Disposition", 'attachment; filename="restic.pass"');

				return c.text(content);
			} catch (_error) {
				return c.json({ message: "Failed to read Restic password file" }, 500);
			}
		},
	);
