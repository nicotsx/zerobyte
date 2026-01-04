import { type } from "arktype";
import { describeRoute, resolver } from "hono-openapi";

// Validation schemas
export const loginBodySchema = type({
	username: "string>0",
	password: "string>7",
});

export const registerBodySchema = type({
	username: "string>2",
	password: "string>7",
});

const loginResponseSchema = type({
	message: "string",
	success: "boolean",
	user: type({
		id: "number",
		username: "string",
		hasDownloadedResticPassword: "boolean",
	}).optional(),
	requiresTwoFactor: "boolean?",
	pendingSessionId: "string?",
});

export const loginDto = describeRoute({
	description: "Login with username and password",
	operationId: "login",
	tags: ["Auth"],
	responses: {
		200: {
			description: "Login successful",
			content: {
				"application/json": {
					schema: resolver(loginResponseSchema),
				},
			},
		},
	},
});

export type LoginDto = typeof loginResponseSchema.infer;

export const registerDto = describeRoute({
	description: "Register a new user",
	operationId: "register",
	tags: ["Auth"],
	responses: {
		201: {
			description: "User created successfully",
			content: {
				"application/json": {
					schema: resolver(loginResponseSchema),
				},
			},
		},
	},
});

export type RegisterDto = typeof loginResponseSchema.infer;

const logoutResponseSchema = type({
	success: "boolean",
});

export const logoutDto = describeRoute({
	description: "Logout current user",
	operationId: "logout",
	tags: ["Auth"],
	responses: {
		200: {
			description: "Logout successful",
			content: {
				"application/json": {
					schema: resolver(logoutResponseSchema),
				},
			},
		},
	},
});

export type LogoutDto = typeof logoutResponseSchema.infer;

export const getMeDto = describeRoute({
	description: "Get current authenticated user",
	operationId: "getMe",
	tags: ["Auth"],
	responses: {
		200: {
			description: "Current user information",
			content: {
				"application/json": {
					schema: resolver(loginResponseSchema),
				},
			},
		},
	},
});

export type GetMeDto = typeof loginResponseSchema.infer;

const statusResponseSchema = type({
	hasUsers: "boolean",
});

export const getStatusDto = describeRoute({
	description: "Get authentication system status",
	operationId: "getStatus",
	tags: ["Auth"],
	responses: {
		200: {
			description: "Authentication system status",
			content: {
				"application/json": {
					schema: resolver(statusResponseSchema),
				},
			},
		},
	},
});

export type GetStatusDto = typeof statusResponseSchema.infer;

export const changePasswordBodySchema = type({
	currentPassword: "string>0",
	newPassword: "string>7",
});

const changePasswordResponseSchema = type({
	success: "boolean",
	message: "string",
});

export const changePasswordDto = describeRoute({
	description: "Change current user password",
	operationId: "changePassword",
	tags: ["Auth"],
	responses: {
		200: {
			description: "Password changed successfully",
			content: {
				"application/json": {
					schema: resolver(changePasswordResponseSchema),
				},
			},
		},
	},
});

export type ChangePasswordDto = typeof changePasswordResponseSchema.infer;

// 2FA Status DTO
const twoFactorStatusResponseSchema = type({
	enabled: "boolean",
});

export const getTwoFactorStatusDto = describeRoute({
	description: "Get 2FA status for current authenticated user",
	operationId: "getTwoFactorStatus",
	tags: ["Auth"],
	responses: {
		200: {
			description: "2FA status",
			content: {
				"application/json": {
					schema: resolver(twoFactorStatusResponseSchema),
				},
			},
		},
		401: {
			description: "Not authenticated",
		},
	},
});

export type GetTwoFactorStatusDto = typeof twoFactorStatusResponseSchema.infer;

// Verify 2FA DTO
export const verify2faBodySchema = type({
	pendingSessionId: "string>0",
	code: /^\d{6}$/,
});

const verify2faResponseSchema = type({
	message: "string",
	success: "boolean",
	user: type({
		id: "number",
		username: "string",
		hasDownloadedResticPassword: "boolean",
	}).optional(),
});

export const verify2faDto = describeRoute({
	description: "Verify 2FA code and complete login",
	operationId: "verify2fa",
	tags: ["Auth"],
	responses: {
		200: {
			description: "2FA verification successful",
			content: {
				"application/json": {
					schema: resolver(verify2faResponseSchema),
				},
			},
		},
		401: {
			description: "Invalid 2FA code or session",
		},
	},
});

export type Verify2faDto = typeof verify2faResponseSchema.infer;

// 2FA Setup DTO (generate secret and return URI for QR code)
const setup2faResponseSchema = type({
	success: "boolean",
	message: "string",
	uri: "string?",
	secret: "string?",
});

export const setup2faDto = describeRoute({
	description: "Generate 2FA setup data (secret and otpauth URI for QR code)",
	operationId: "setup2fa",
	tags: ["Auth"],
	responses: {
		200: {
			description: "2FA setup data",
			content: {
				"application/json": {
					schema: resolver(setup2faResponseSchema),
				},
			},
		},
		400: {
			description: "2FA already enabled or other error",
		},
		401: {
			description: "Not authenticated",
		},
	},
});

export type Setup2faDto = typeof setup2faResponseSchema.infer;

// 2FA Enable DTO (verify code and enable)
export const enable2faBodySchema = type({
	password: "string>0",
	code: /^\d{6}$/,
	secret: "string>0",
});

const enable2faResponseSchema = type({
	success: "boolean",
	message: "string",
});

export const enable2faDto = describeRoute({
	description: "Verify 2FA code and enable 2FA for the account",
	operationId: "enable2fa",
	tags: ["Auth"],
	responses: {
		200: {
			description: "2FA enabled successfully",
			content: {
				"application/json": {
					schema: resolver(enable2faResponseSchema),
				},
			},
		},
		400: {
			description: "Invalid code or 2FA already enabled",
		},
		401: {
			description: "Not authenticated",
		},
	},
});

export type Enable2faDto = typeof enable2faResponseSchema.infer;

// 2FA Disable DTO (require password and TOTP code)
export const disable2faBodySchema = type({
	password: "string>0",
	code: /^\d{6}$/,
});

const disable2faResponseSchema = type({
	success: "boolean",
	message: "string",
});

export const disable2faDto = describeRoute({
	description: "Disable 2FA for the account (requires password and current TOTP code)",
	operationId: "disable2fa",
	tags: ["Auth"],
	responses: {
		200: {
			description: "2FA disabled successfully",
			content: {
				"application/json": {
					schema: resolver(disable2faResponseSchema),
				},
			},
		},
		400: {
			description: "Invalid password or code, or 2FA not enabled",
		},
		401: {
			description: "Not authenticated",
		},
	},
});

export type Disable2faDto = typeof disable2faResponseSchema.infer;

export type LoginBody = typeof loginBodySchema.infer;
export type RegisterBody = typeof registerBodySchema.infer;
export type ChangePasswordBody = typeof changePasswordBodySchema.infer;
export type Enable2faBody = typeof enable2faBodySchema.infer;
export type Disable2faBody = typeof disable2faBodySchema.infer;
