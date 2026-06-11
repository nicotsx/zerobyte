import { safeJsonParse } from "@zerobyte/core/utils";
import { z } from "zod";

const apiKeyMetadataSchema = z.object({
	organizationId: z.string(),
});

export const parseApiKeyOrganizationId = (metadata: string | null | undefined) => {
	const parsed = apiKeyMetadataSchema.safeParse(safeJsonParse(metadata));

	return parsed.success ? parsed.data.organizationId : null;
};
