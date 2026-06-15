import { Hono } from "hono";
import { createMiddleware } from "hono/factory";
import { validator } from "hono-openapi";
import { DESKTOP_LAUNCH_SECRET_HEADER, desktopService, verifyDesktopLaunchSecret } from "./desktop.service";
import { createDesktopSessionBody, createDesktopSessionDto } from "./desktop.dto";

const requireDesktopLaunchSecret = createMiddleware(async (c, next) => {
	verifyDesktopLaunchSecret(c.req.header(DESKTOP_LAUNCH_SECRET_HEADER));
	await next();
});

export const desktopController = new Hono().post(
	"/session",
	requireDesktopLaunchSecret,
	createDesktopSessionDto,
	validator("json", createDesktopSessionBody),
	async (c) => {
		return desktopService.createDesktopSessionResponse(c.req.valid("json"));
	},
);
