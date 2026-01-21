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

export const userDeletionImpactDto = type({
	organizations: type({
		id: "string",
		name: "string",
		resources: {
			volumesCount: "number",
			repositoriesCount: "number",
			backupSchedulesCount: "number",
		},
	}).array(),
});

export type UserDeletionImpactDto = typeof userDeletionImpactDto.infer;

export const getUserDeletionImpactDto = describeRoute({
	description: "Get impact of deleting a user",
	operationId: "getUserDeletionImpact",
	tags: ["Auth"],
	responses: {
		200: {
			description: "List of organizations and resources to be deleted",
			content: {
				"application/json": {
					schema: resolver(userDeletionImpactDto),
				},
			},
		},
	},
});
