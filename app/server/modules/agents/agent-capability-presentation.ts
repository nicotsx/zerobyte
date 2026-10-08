import { MAX_AGENT_TRUSTED_ROOTS } from "@zerobyte/contracts/agent-protocol";
import { trustedRootDescriptorSchema } from "@zerobyte/contracts/volumes";
import { z } from "zod";
import { getSafeAllowedLocationLabel, getSafePresentationText } from "~/lib/safe-presentation-label";
import type { AgentCapabilities } from "~/server/db/schema";

const MAX_HOSTNAME_LENGTH = 255;
const MAX_PLATFORM_LENGTH = 128;

export const publicAgentCapabilitiesSchema = z.object({
	hostname: z.string().nullable(),
	platform: z.string().nullable(),
	trustedRoots: z.array(trustedRootDescriptorSchema).max(MAX_AGENT_TRUSTED_ROOTS),
});

export type PublicAgentCapabilities = z.infer<typeof publicAgentCapabilitiesSchema>;
export type TrustedRootsCompatibility =
	| { compatible: true; trustedRoots: PublicAgentCapabilities["trustedRoots"] }
	| { compatible: false; trustedRoots: [] };

export const parseTrustedRootsCompatibility = (capabilities: AgentCapabilities): TrustedRootsCompatibility => {
	const rawRoots = capabilities.trustedRoots;
	if (!Array.isArray(rawRoots) || rawRoots.length > MAX_AGENT_TRUSTED_ROOTS) {
		return { compatible: false, trustedRoots: [] };
	}

	const trustedRoots: PublicAgentCapabilities["trustedRoots"] = [];
	for (const rawRoot of rawRoots) {
		const parsedRoot = trustedRootDescriptorSchema.safeParse(rawRoot);
		if (!parsedRoot.success) {
			return { compatible: false, trustedRoots: [] };
		}
		const label = getSafeAllowedLocationLabel(parsedRoot.data.label);
		const trustedRoot = { id: parsedRoot.data.id, label, canBackup: parsedRoot.data.canBackup };
		trustedRoots.push(trustedRoot);
	}

	return { compatible: true, trustedRoots };
};

export const presentAgentCapabilities = (capabilities: AgentCapabilities): PublicAgentCapabilities => {
	const hostname = getSafePresentationText(capabilities.hostname, MAX_HOSTNAME_LENGTH);
	const platform = getSafePresentationText(capabilities.platform, MAX_PLATFORM_LENGTH);
	const trustedRootsCompatibility = parseTrustedRootsCompatibility(capabilities);
	const trustedRoots = trustedRootsCompatibility.trustedRoots;
	const presentation = { hostname, platform, trustedRoots };
	return presentation;
};
