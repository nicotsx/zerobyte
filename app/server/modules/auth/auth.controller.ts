import { validator } from "hono-openapi";
import { rateLimiter } from "hono-rate-limiter";
import { Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import {
	changePasswordBodySchema,
	changePasswordDto,
	disable2faBodySchema,
	disable2faDto,
	enable2faBodySchema,
	enable2faDto,
	getMeDto,
	getStatusDto,
	getTwoFactorStatusDto,
	loginBodySchema,
	loginDto,
	logoutDto,
	registerBodySchema,
	registerDto,
	setup2faDto,
	verify2faBodySchema,
	verify2faDto,
	type ChangePasswordDto,
	type Disable2faDto,
	type Enable2faDto,
	type GetMeDto,
	type GetStatusDto,
	type GetTwoFactorStatusDto,
	type LoginDto,
	type LogoutDto,
	type RegisterDto,
	type Setup2faDto,
	type Verify2faDto,
} from "./auth.dto";
import { authService } from "./auth.service";
import { toMessage } from "../../utils/errors";
import { config } from "~/server/core/config";

const COOKIE_NAME = "session_id";
const COOKIE_OPTIONS = {
	httpOnly: true,
	secure: false,
	sameSite: "lax" as const,
	path: "/",
};

const authRateLimiter = rateLimiter({
	windowMs: 15 * 60 * 1000,
	limit: 20,
	keyGenerator: (c) => c.req.header("x-forwarded-for") ?? "",
	skip: () => {
		return config.__prod__ === false;
	},
});

export const authController = new Hono()
	.post("/register", authRateLimiter, registerDto, validator("json", registerBodySchema), async (c) => {
		const body = c.req.valid("json");

		try {
			const { user, sessionId } = await authService.register(body.username, body.password);

			setCookie(c, COOKIE_NAME, sessionId, {
				...COOKIE_OPTIONS,
				expires: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
			});

			return c.json<RegisterDto>(
				{
					success: true,
					message: "User registered successfully",
					user: {
						id: user.id,
						username: user.username,
						hasDownloadedResticPassword: user.hasDownloadedResticPassword,
					},
				},
				201,
			);
		} catch (error) {
			return c.json<RegisterDto>({ success: false, message: toMessage(error) }, 400);
		}
	})
	.post("/login", authRateLimiter, loginDto, validator("json", loginBodySchema), async (c) => {
		const body = c.req.valid("json");

		try {
			const result = await authService.login(body.username, body.password);

			if (result.requiresTwoFactor) {
				return c.json<LoginDto>({
					success: true,
					message: "2FA verification required",
					requiresTwoFactor: true,
					pendingSessionId: result.pendingSessionId,
				});
			}

			setCookie(c, COOKIE_NAME, result.sessionId, {
				...COOKIE_OPTIONS,
				expires: new Date(result.expiresAt),
			});

			return c.json<LoginDto>({
				success: true,
				message: "Login successful",
				user: {
					id: result.user.id,
					username: result.user.username,
					hasDownloadedResticPassword: result.user.hasDownloadedResticPassword,
				},
			});
		} catch (error) {
			return c.json<LoginDto>({ success: false, message: toMessage(error) }, 401);
		}
	})
	.post("/verify-2fa", authRateLimiter, verify2faDto, validator("json", verify2faBodySchema), async (c) => {
		const body = c.req.valid("json");

		try {
			const { sessionId, user, expiresAt } = await authService.verifyTwoFactor(body.pendingSessionId, body.code);

			setCookie(c, COOKIE_NAME, sessionId, {
				...COOKIE_OPTIONS,
				expires: new Date(expiresAt),
			});

			return c.json<Verify2faDto>({
				success: true,
				message: "Login successful",
				user: {
					id: user.id,
					username: user.username,
					hasDownloadedResticPassword: user.hasDownloadedResticPassword,
				},
			});
		} catch (error) {
			return c.json<Verify2faDto>({ success: false, message: toMessage(error) }, 401);
		}
	})
	.post("/logout", authRateLimiter, logoutDto, async (c) => {
		const sessionId = getCookie(c, COOKIE_NAME);

		if (sessionId) {
			await authService.logout(sessionId);
			deleteCookie(c, COOKIE_NAME, COOKIE_OPTIONS);
		}

		return c.json<LogoutDto>({ success: true });
	})
	.get("/me", getMeDto, async (c) => {
		const sessionId = getCookie(c, COOKIE_NAME);

		if (!sessionId) {
			return c.json<GetMeDto>({ success: false, message: "Not authenticated" }, 401);
		}

		const session = await authService.verifySession(sessionId);

		if (!session) {
			deleteCookie(c, COOKIE_NAME, COOKIE_OPTIONS);
			return c.json({ message: "Not authenticated" }, 401);
		}

		return c.json<GetMeDto>({
			success: true,
			user: session.user,
			message: "Authenticated",
		});
	})
	.get("/status", getStatusDto, async (c) => {
		const hasUsers = await authService.hasUsers();
		return c.json<GetStatusDto>({ hasUsers });
	})
	.post(
		"/change-password",
		authRateLimiter,
		changePasswordDto,
		validator("json", changePasswordBodySchema),
		async (c) => {
			const sessionId = getCookie(c, COOKIE_NAME);

			if (!sessionId) {
				return c.json<ChangePasswordDto>({ success: false, message: "Not authenticated" }, 401);
			}

			const session = await authService.verifySession(sessionId);

			if (!session) {
				deleteCookie(c, COOKIE_NAME, COOKIE_OPTIONS);
				return c.json<ChangePasswordDto>({ success: false, message: "Not authenticated" }, 401);
			}

			const body = c.req.valid("json");

			try {
				await authService.changePassword(session.user.id, body.currentPassword, body.newPassword);
				return c.json<ChangePasswordDto>({ success: true, message: "Password changed successfully" });
			} catch (error) {
				return c.json<ChangePasswordDto>({ success: false, message: toMessage(error) }, 400);
			}
		},
	)
	.get("/2fa-status", getTwoFactorStatusDto, async (c) => {
		const sessionId = getCookie(c, COOKIE_NAME);

		if (!sessionId) {
			return c.json({ message: "Not authenticated" }, 401);
		}

		const session = await authService.verifySession(sessionId);

		if (!session) {
			deleteCookie(c, COOKIE_NAME, COOKIE_OPTIONS);
			return c.json({ message: "Not authenticated" }, 401);
		}

		const enabled = await authService.getTwoFactorStatus(session.user.id);
		return c.json<GetTwoFactorStatusDto>({ enabled });
	})
	.post("/2fa/setup", authRateLimiter, setup2faDto, async (c) => {
		const sessionId = getCookie(c, COOKIE_NAME);

		if (!sessionId) {
			return c.json<Setup2faDto>({ success: false, message: "Not authenticated" }, 401);
		}

		const session = await authService.verifySession(sessionId);

		if (!session) {
			deleteCookie(c, COOKIE_NAME, COOKIE_OPTIONS);
			return c.json<Setup2faDto>({ success: false, message: "Not authenticated" }, 401);
		}

		try {
			const { uri, secret } = await authService.setupTwoFactor(session.user.id);
			return c.json<Setup2faDto>({
				success: true,
				message: "2FA setup data generated",
				uri,
				secret,
			});
		} catch (error) {
			return c.json<Setup2faDto>({ success: false, message: toMessage(error) }, 400);
		}
	})
	.post("/2fa/enable", authRateLimiter, enable2faDto, validator("json", enable2faBodySchema), async (c) => {
		const sessionId = getCookie(c, COOKIE_NAME);

		if (!sessionId) {
			return c.json<Enable2faDto>({ success: false, message: "Not authenticated" }, 401);
		}

		const session = await authService.verifySession(sessionId);

		if (!session) {
			deleteCookie(c, COOKIE_NAME, COOKIE_OPTIONS);
			return c.json<Enable2faDto>({ success: false, message: "Not authenticated" }, 401);
		}

		const body = c.req.valid("json");

		try {
			await authService.enableTwoFactor(session.user.id, body.password, body.secret, body.code);
			// Clear the session cookie since all sessions were invalidated
			deleteCookie(c, COOKIE_NAME, COOKIE_OPTIONS);
			return c.json<Enable2faDto>({
				success: true,
				message: "2FA enabled successfully. Please log in again.",
			});
		} catch (error) {
			return c.json<Enable2faDto>({ success: false, message: toMessage(error) }, 400);
		}
	})
	.post("/2fa/disable", authRateLimiter, disable2faDto, validator("json", disable2faBodySchema), async (c) => {
		const sessionId = getCookie(c, COOKIE_NAME);

		if (!sessionId) {
			return c.json<Disable2faDto>({ success: false, message: "Not authenticated" }, 401);
		}

		const session = await authService.verifySession(sessionId);

		if (!session) {
			deleteCookie(c, COOKIE_NAME, COOKIE_OPTIONS);
			return c.json<Disable2faDto>({ success: false, message: "Not authenticated" }, 401);
		}

		const body = c.req.valid("json");

		try {
			await authService.disableTwoFactor(session.user.id, body.password, body.code);
			// Clear the session cookie since all sessions were invalidated
			deleteCookie(c, COOKIE_NAME, COOKIE_OPTIONS);
			return c.json<Disable2faDto>({
				success: true,
				message: "2FA disabled successfully. Please log in again.",
			});
		} catch (error) {
			return c.json<Disable2faDto>({ success: false, message: toMessage(error) }, 400);
		}
	});
