import { presentedVolumeSchema } from "@zerobyte/contracts/volumes";
import type { Volume } from "../../db/schema";
import { loadSourceLocationPresentationContext, presentSourceLocation } from "./source-discovery";
import { toCanonicalVolume } from "./volume-execution-source";

export const presentVolumes = async (volumes: Volume[], organizationId: string) => {
	const context = await loadSourceLocationPresentationContext(volumes, organizationId);
	return volumes.map((volume) => {
		const canonicalVolume = toCanonicalVolume(volume);
		const sourceLocation = volume.sourceKind === "managed" ? null : presentSourceLocation(volume, context);
		return presentedVolumeSchema.parse({ ...canonicalVolume, sourceLocation });
	});
};
