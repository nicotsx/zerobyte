import { agentReleaseManifestSchema } from "@zerobyte/contracts/agent-release";
import { safeJsonParse } from "@zerobyte/core/utils";
import { customType } from "drizzle-orm/sqlite-core";
import { z } from "zod";

const attemptSchema = z.object({ requestId: z.uuid(), attemptId: z.uuid() });
const previousAttemptSchema = attemptSchema
	.extend({
		reason: z.enum(["expired", "replaced"]).optional(),
		renewedRequestId: z.uuid().optional(),
	})
	.transform(({ requestId, attemptId, reason, renewedRequestId }) => ({
		requestId,
		attemptId,
		reason: reason ?? (renewedRequestId ? "expired" : "replaced"),
	}));

const updateSchema = z.object({
	requestId: z.uuid(),
	target: agentReleaseManifestSchema,
	requestedAt: z.int().nonnegative(),
	attemptId: z.uuid().optional(),
	previousAttempt: previousAttemptSchema.optional(),
});

const attemptLeaseSchema = z.object({ processId: z.uuid(), deadline: z.number().nonnegative() });

const storedAgentUpdateSchema = z.discriminatedUnion("status", [
	updateSchema.extend({ status: z.literal("queued") }),
	updateSchema.extend({
		status: z.enum(["started", "confirming"]),
		attemptId: z.uuid(),
		startedAt: z.int().nonnegative().optional(),
		lease: attemptLeaseSchema.optional(),
	}),
	updateSchema.extend({ status: z.literal("failed") }),
	updateSchema.extend({ status: z.literal("completed") }),
	updateSchema.extend({ status: z.literal("accepted"), attemptId: z.uuid() }),
	updateSchema.extend({ status: z.literal("superseded") }),
]);

export type ExactAttempt = z.infer<typeof attemptSchema>;
export type AgentUpdate = z.infer<typeof storedAgentUpdateSchema>;
export type AttemptLease = z.infer<typeof attemptLeaseSchema>;

export const agentUpdateColumn = customType<{ data: AgentUpdate | null; driverData: string | null }>({
	dataType: () => "text",
	toDriver: (value) => (value === null ? null : JSON.stringify(value)),
	fromDriver: (value) => storedAgentUpdateSchema.safeParse(safeJsonParse<unknown>(value)).data ?? null,
});
