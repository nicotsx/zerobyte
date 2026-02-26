import type { BandwidthLimit } from "~/schemas/restic";

export const formatBandwidthLimit = (limit?: BandwidthLimit): string => {
	if (!limit || !limit.enabled || limit.value <= 0) {
		return "";
	}

	let kibibytesPerSecond: number;
	switch (limit.unit) {
		case "Kbps":
			kibibytesPerSecond = (limit.value * 1000) / 8 / 1024;
			break;
		case "Mbps":
			kibibytesPerSecond = (limit.value * 1000000) / (8 * 1024);
			break;
		case "Gbps":
			kibibytesPerSecond = (limit.value * 1000000000) / (8 * 1024);
			break;
		default:
			return "";
	}

	const limitValue = Math.max(1, Math.floor(kibibytesPerSecond));
	return `${limitValue}`;
};
