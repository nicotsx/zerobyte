import { trustedRootDescriptorSchema } from "@zerobyte/contracts/volumes";
import { z } from "zod";
import { getSafeAllowedLocationLabel, getSafePresentationText } from "~/lib/safe-presentation-label";
import type { AgentCapabilities } from "~/server/db/schema";

export const publicAgentCapabilitiesSchema = z.object({
	hostname: z.string().nullable(),
	platform: z.string().nullable(),
	trustedRoots: z.array(trustedRootDescriptorSchema),
});

export const presentAgentCapabilities = (capabilities: AgentCapabilities) => ({
	hostname: getSafePresentationText(capabilities.hostname, 255),
	platform: getSafePresentationText(capabilities.platform, 128),
	trustedRoots: (capabilities.trustedRoots ?? []).map((root) => ({
		id: root.id,
		label: getSafeAllowedLocationLabel(root.label),
		canBackup: root.canBackup,
	})),
});
