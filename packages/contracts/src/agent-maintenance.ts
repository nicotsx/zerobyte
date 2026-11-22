import { z } from "zod";
import { agentReleaseManifestSchema } from "./agent-release-manifest";

export const AGENT_MAINTENANCE_ROUTE = "/maintenance";
export const AGENT_MAINTENANCE_PATH = `/api/v1/agents${AGENT_MAINTENANCE_ROUTE}`;
export const AGENT_MAINTENANCE_MAX_REQUEST_BYTES = 512;
export const AGENT_MAINTENANCE_MAX_RESPONSE_BYTES = 1024;
export const AGENT_UPDATE_TAG_MAX_LENGTH = 129;

const attempt = {
	requestId: z.uuid(),
	attemptId: z.uuid(),
};

export const agentMaintenanceRequestSchema = z.discriminatedUnion("action", [
	z.strictObject({ action: z.literal("poll") }),
	z.strictObject({ action: z.literal("start"), ...attempt }),
	z.strictObject({ action: z.literal("fail"), ...attempt }),
	z.strictObject({ action: z.literal("failPreparation"), ...attempt }),
	z.strictObject({ action: z.literal("confirm"), ...attempt }),
	z.strictObject({ action: z.literal("accept"), ...attempt }),
]);

export const agentMaintenanceResponseSchema = z.strictObject({
	update: z
		.strictObject({
			requestId: z.uuid(),
			status: z.enum(["queued", "started"]),
			target: agentReleaseManifestSchema.extend({
				tag: agentReleaseManifestSchema.shape.tag.max(AGENT_UPDATE_TAG_MAX_LENGTH),
			}),
		})
		.nullable(),
});

export type AgentMaintenanceRequest = z.infer<typeof agentMaintenanceRequestSchema>;
export type AgentMaintenanceResponse = z.infer<typeof agentMaintenanceResponseSchema>;
