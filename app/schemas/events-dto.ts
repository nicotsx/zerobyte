import { z } from "zod";

const organizationScopedSchema = z.object({
	organizationId: z.string(),
});

const dumpStartedEventSchema = z.object({
	repositoryId: z.string(),
	snapshotId: z.string(),
	path: z.string(),
	filename: z.string(),
});
const serverDumpStartedEventSchema = organizationScopedSchema.extend(dumpStartedEventSchema.shape);

export type ServerDumpStartedEventDto = z.infer<typeof serverDumpStartedEventSchema>;
