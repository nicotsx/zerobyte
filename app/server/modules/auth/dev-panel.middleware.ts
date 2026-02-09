import type { Context, Next } from "hono";
import { systemService } from "../system/system.service";

export const requireDevPanel = async (c: Context, next: Next) => {
	if (!systemService.isDevPanelEnabled()) {
		return c.json({ message: "Dev panel not enabled" }, 403);
	}
	await next();
};
