import { agentCapabilitiesSchema, agentProtocolVersionSchema } from "@zerobyte/contracts/agent-protocol";
import { safeJsonParse } from "@zerobyte/core/utils";
import { customType } from "drizzle-orm/sqlite-core";
import { z } from "zod";

const wire = agentCapabilitiesSchema.shape;
const storedAgentCapabilitiesSchema = agentCapabilitiesSchema
	.extend({
		hostname: wire.hostname.catch(undefined),
		platform: wire.platform.catch(undefined),
		agentVersion: wire.agentVersion.catch(undefined),
		resticVersion: wire.resticVersion.catch(undefined),
		restore: wire.restore.catch(undefined),
		trustedRoots: wire.trustedRoots.catch(undefined),
		protocolVersion: agentProtocolVersionSchema.optional().catch(undefined),
		protocolCompatible: z.boolean().optional().catch(undefined),
		connectionSecurity: z.enum(["secure", "insecure"]).nullish().catch(undefined),
	})
	.catch({});

export const agentCapabilitiesColumn = customType<{
	data: z.infer<typeof storedAgentCapabilitiesSchema>;
	driverData: string;
}>({
	dataType: () => "text",
	toDriver: (value) => JSON.stringify(value),
	fromDriver: (value) => storedAgentCapabilitiesSchema.parse(safeJsonParse<unknown>(value)),
});
