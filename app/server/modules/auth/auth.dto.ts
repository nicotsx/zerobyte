import { type } from "arktype";
import { describeRoute, resolver } from "hono-openapi";

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
