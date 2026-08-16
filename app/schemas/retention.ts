import { z } from "zod";

export const retentionPolicySchema = z.object({
	keepLast: z.number().optional(),
	keepHourly: z.number().optional(),
	keepDaily: z.number().optional(),
	keepWeekly: z.number().optional(),
	keepMonthly: z.number().optional(),
	keepYearly: z.number().optional(),
	keepWithinDuration: z.string().optional(),
});

export type RetentionPolicy = z.infer<typeof retentionPolicySchema>;
