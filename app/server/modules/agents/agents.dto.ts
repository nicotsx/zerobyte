import { describeRoute, resolver } from "hono-openapi";
import { z } from "zod";
import { isValidMachineName, MACHINE_NAME_MAX_LENGTH } from "~/lib/machine-name";
import { publicAgentCapabilitiesSchema } from "./agent-capability-presentation";

export const publicAgentSchema = z.object({
	id: z.string(),
	organizationId: z.string().nullable(),
	name: z.string(),
	kind: z.enum(["local", "remote"]),
	status: z.enum(["offline", "connecting", "online", "degraded"]),
	capabilities: publicAgentCapabilitiesSchema,
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
const rotationResponseSchema = z.object({ agent: publicAgentSchema, token: z.string(), expiresAt: z.number() });
export type ListAgentsDto = z.infer<typeof publicAgentSchema>[];
export type CreateAgentDto = z.infer<typeof enrollmentResponseSchema>;
export type RotateAgentTokenDto = z.infer<typeof rotationResponseSchema>;
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
	responses: { 200: response(rotationResponseSchema, "Enrollment token rotated") },
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
