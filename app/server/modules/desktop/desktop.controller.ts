import { Hono } from "hono";
import { createMiddleware } from "hono/factory";
import { setSignedCookie } from "hono/cookie";
import { validator } from "hono-openapi";
import { auth } from "~/server/lib/auth";
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
		const { session, user } = await desktopService.createDesktopSession(c.req.valid("json"));
		const authContext = await auth.$context;

		await setSignedCookie(c, authContext.authCookies.sessionToken.name, session.token, authContext.secret, {
			...authContext.authCookies.sessionToken.attributes,
			maxAge: authContext.sessionConfig.expiresIn,
		});

		return c.json({
			redirect: false,
			token: session.token,
			url: undefined,
			user,
		});
	},
);
