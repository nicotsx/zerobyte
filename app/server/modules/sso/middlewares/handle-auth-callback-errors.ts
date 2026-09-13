import { createMiddleware } from "hono/factory";
import { config } from "~/server/core/config";
import { mapAuthErrorToCode } from "../sso.errors";
import { isSsoCallbackPath } from "../utils/sso-context";

const OAUTH_CALLBACK_PATH = /^\/api\/auth\/callback\/[^/]+\/?$/;

export const handleAuthCallbackErrors = createMiddleware(async (c, next) => {
	await next();

	if (c.res.status < 400 || !(isSsoCallbackPath(c.req.path) || OAUTH_CALLBACK_PATH.test(c.req.path))) return;

	const body: { code?: unknown; message?: unknown } | null = await c.res
		.clone()
		.json()
		.catch(() => null);
	const code = mapAuthErrorToCode(body?.code);
	const errorCode = code === "SSO_LOGIN_FAILED" ? mapAuthErrorToCode(body?.message) : code;

	c.header("Location", `${config.baseUrl}/login?error=${errorCode}`);
	c.header("Cache-Control", "no-store");
	c.header("Content-Type", undefined);
	c.header("Content-Length", undefined);
	c.header("Content-Encoding", undefined);
	c.res = c.body(null, 303);
});
