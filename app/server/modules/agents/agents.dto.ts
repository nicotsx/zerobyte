import { describeRoute, resolver } from "hono-openapi";
import { z } from "zod";
import { AGENT_UPDATE_TAG_MAX_LENGTH, agentMaintenanceResponseSchema } from "@zerobyte/contracts/agent-maintenance";
import { isValidMachineName, MACHINE_NAME_MAX_LENGTH } from "~/lib/machine-name";
import { publicAgentCapabilitiesSchema } from "./agent-capability-presentation";

const agentUpdateSchema = z.object({
	protocolVersion: z.number().nullable(),
	availability: z.enum(["none", "required", "available"]),
	delivery: z.enum(["remote", "manual"]).nullable(),
	targetTag: z.string().nullable(),
	request: z
		.object({
			id: z.uuid(),
			targetTag: z.string(),
			status: z.enum(["queued", "started", "failed", "completed", "superseded"]),
			requestedAt: z.number(),
		})
		.nullable(),
});

export const requestAgentUpdateBody = z.strictObject({ targetTag: z.string().min(1).max(AGENT_UPDATE_TAG_MAX_LENGTH) });

export const publicAgentSchema = z.object({
	id: z.string(),
	organizationId: z.string().nullable(),
	name: z.string(),
	kind: z.enum(["local", "remote"]),
	status: z.enum(["offline", "connecting", "online", "degraded"]),
	capabilities: publicAgentCapabilitiesSchema,
	update: agentUpdateSchema,
	lastSeenAt: z.number().nullable(),
	lastReadyAt: z.number().nullable(),
	createdAt: z.number(),
	updatedAt: z.number(),
	revokedAt: z.number().nullable(),
	credentialVersion: z.number(),
});

export const createAgentBody = z.object({
	name: z.string().refine(isValidMachineName).trim().min(1).max(MACHINE_NAME_MAX_LENGTH),
});

const enrollmentResponseSchema = z.object({
	agent: publicAgentSchema,
	controllerUrl: z.string(),
	token: z.string(),
	expiresAt: z.number(),
});

export type ListAgentsDto = z.infer<typeof publicAgentSchema>[];
export type CreateAgentDto = z.infer<typeof enrollmentResponseSchema>;
export type RotateAgentTokenDto = z.infer<typeof enrollmentResponseSchema>;
export type RevokeAgentTokenDto = z.infer<typeof publicAgentSchema>;

const response = (schema: z.ZodType, description: string) => ({
	description,
	content: { "application/json": { schema: resolver(schema) } },
});

export const listAgentsDto = describeRoute({
	operationId: "listAgents",
	tags: ["Agents"],
	responses: { 200: response(z.array(publicAgentSchema), "Agents") },
});

export const createAgentDto = describeRoute({
	operationId: "createRemoteAgent",
	tags: ["Agents"],
	responses: { 201: response(enrollmentResponseSchema, "Remote agent enrollment created") },
});

export const rotateAgentTokenDto = describeRoute({
	operationId: "rotateRemoteAgentToken",
	tags: ["Agents"],
	responses: { 200: response(enrollmentResponseSchema, "Enrollment token rotated") },
});

export const revokeAgentTokenDto = describeRoute({
	operationId: "revokeRemoteAgentToken",
	tags: ["Agents"],
	responses: { 200: response(publicAgentSchema, "Enrollment token revoked") },
});

export const deleteAgentDto = describeRoute({
	operationId: "deleteRemoteAgent",
	tags: ["Agents"],
	responses: { 200: response(z.object({ success: z.boolean() }), "Remote machine deleted") },
});

const errorSchema = z.object({ message: z.string() });

export const requestAgentUpdateDto = describeRoute({
	operationId: "requestAgentUpdate",
	tags: ["Agents"],
	responses: {
		200: response(agentUpdateSchema, "Agent update request"),
		401: response(errorSchema, "Sign in with a current browser session"),
		403: response(errorSchema, "Organization owner or administrator permission is required"),
		404: response(errorSchema, "Remote agent not found in this organization"),
		409: response(errorSchema, "Refresh the agent and release details before trying again"),
		503: response(
			errorSchema,
			"Remote agents are disabled or no verified release is available for this server version",
		),
	},
});

export const agentMaintenanceDto = describeRoute({
	operationId: "maintainRemoteAgent",
	tags: ["Agents"],
	security: [{ agentBearer: [] }],
	responses: {
		200: response(agentMaintenanceResponseSchema, "Agent maintenance result"),
		401: response(errorSchema, "A current enrolled agent credential is required"),
		409: response(errorSchema, "The update attempt is stale or awaiting controller readiness."),
		410: response(errorSchema, "The update attempt has expired, been replaced, or finalized."),
		413: response(errorSchema, "Reduce the request body to the maintenance request size limit"),
		426: response(errorSchema, "Use HTTPS for agent maintenance"),
		503: response(errorSchema, "Remote agents are disabled on this controller"),
	},
});
