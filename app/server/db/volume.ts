import type { Volume, VolumeRow } from "./schema";

export const readVolume = (row: VolumeRow): Volume => {
	const { sourceKind, config, type, trustedRootId, relativePath } = row;

	if (
		sourceKind === "managed" &&
		config !== null &&
		type !== null &&
		trustedRootId === null &&
		relativePath === null
	) {
		return { ...row, sourceKind, config, type, trustedRootId, relativePath };
	}

	if (
		sourceKind === "filesystem" &&
		config === null &&
		type === null &&
		trustedRootId !== null &&
		relativePath !== null
	) {
		return { ...row, sourceKind, config, type, trustedRootId, relativePath };
	}

	throw new Error(`Invalid stored source configuration for volume ${row.shortId}`);
};
