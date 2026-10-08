import { isRemoteSource } from "@zerobyte/contracts/backup-context";
import type { StatusVariant } from "~/client/components/status-dot";
import type { Volume } from "~/client/lib/types";

export const getVolumeStatusLabel = (volume: Volume) => {
	if (volume.sourceKind === "managed") return volume.status;

	return volume.status === "mounted" ? "available" : "unavailable";
};

export const getVolumeStatusVariant = (volume: Volume): StatusVariant =>
	(({ mounted: "success", unmounted: "neutral", error: "error" }) as const)[volume.status];

export const getSourceLabel = (volume: Volume) => {
	if (volume.sourceKind === "managed" || !isRemoteSource(volume)) return volume.name;

	return `${volume.sourceLocation.machine} · ${volume.name}`;
};
