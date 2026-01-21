import { Hono } from "hono";
import { type GetStatusDto, getStatusDto, getUserDeletionImpactDto, type UserDeletionImpactDto } from "./auth.dto";
import { authService } from "./auth.service";
import { requireAdmin, requireAuth } from "./auth.middleware";

export const authController = new Hono()
	.get("/status", getStatusDto, async (c) => {
		const hasUsers = await authService.hasUsers();
		return c.json<GetStatusDto>({ hasUsers });
	})
	.get("/deletion-impact/:userId", requireAuth, requireAdmin, getUserDeletionImpactDto, async (c) => {
		const userId = c.req.param("userId");
		const impact = await authService.getUserDeletionImpact(userId);
		return c.json<UserDeletionImpactDto>(impact);
	});
