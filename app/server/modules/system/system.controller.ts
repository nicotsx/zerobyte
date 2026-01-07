import { Hono } from "hono";
import { validator } from "hono-openapi";
import {
	downloadResticPasswordBodySchema,
	downloadResticPasswordDto,
	fullExportBodySchema,
	fullExportDto,
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

			const [dbUser] = await db.select().from(usersTable).where(eq(usersTable.id, user.id));

			if (!dbUser) {
				return c.json({ message: "User not found" }, 401);
			}

			const isValid = await Bun.password.verify(body.password, dbUser.passwordHash);

			if (!isValid) {
				return c.json({ message: "Incorrect password" }, 401);
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
	)
	.post("/export", fullExportDto, validator("json", fullExportBodySchema), async (c) => {
		const user = c.get("user");
		const { password, ...body } = c.req.valid("json");

		const [dbUser] = await db.select().from(usersTable).where(eq(usersTable.id, user.id));

		if (!dbUser) {
			return c.json({ message: "User not found" }, 401);
		}

		const isValid = await Bun.password.verify(password, dbUser.passwordHash);

		if (!isValid) {
			return c.json({ message: "Incorrect password" }, 401);
		}

		const res = await systemService.exportConfig(body);

		return c.json(res);
	});
