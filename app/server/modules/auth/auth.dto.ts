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

export const verifyPasswordBodySchema = type({
	password: "string>0",
});

const verifyPasswordResponseSchema = type({
	success: "boolean",
	message: "string",
});

export const verifyPasswordDto = describeRoute({
	description: "Verify current user password for re-authentication",
	operationId: "verifyPassword",
	tags: ["Auth"],
	responses: {
		200: {
			description: "Password verification result",
			content: {
				"application/json": {
					schema: resolver(verifyPasswordResponseSchema),
				},
			},
		},
	},
});

export type VerifyPasswordDto = typeof verifyPasswordResponseSchema.infer;

export type LoginBody = typeof loginBodySchema.infer;
export type RegisterBody = typeof registerBodySchema.infer;
export type ChangePasswordBody = typeof changePasswordBodySchema.infer;
export type VerifyPasswordBody = typeof verifyPasswordBodySchema.infer;
