import { bandwidthLimitSchema, type RepositoryConfig } from "@zerobyte/core/restic";

export const bandwidthFields = (config: RepositoryConfig) => {
	const uploadLimit = bandwidthLimitSchema.parse(config.uploadLimit ?? {});
	const downloadLimit = bandwidthLimitSchema.parse(config.downloadLimit ?? {});

	return {
		uploadLimitEnabled: uploadLimit.enabled,
		uploadLimitValue: uploadLimit.value,
		uploadLimitUnit: uploadLimit.unit,
		downloadLimitEnabled: downloadLimit.enabled,
		downloadLimitValue: downloadLimit.value,
		downloadLimitUnit: downloadLimit.unit,
	};
};
