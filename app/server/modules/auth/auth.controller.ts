import { Hono } from "hono";
import { getStatusDto, type GetStatusDto } from "./auth.dto";
import { authService } from "./auth.service";

export const authController = new Hono().get("/status", getStatusDto, async (c) => {
	const hasUsers = await authService.hasUsers();
	return c.json<GetStatusDto>({ hasUsers });
});
