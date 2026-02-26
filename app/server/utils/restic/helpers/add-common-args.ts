import type { RepositoryConfig } from "~/schemas/restic";
import { formatBandwidthLimit } from "./bandwidth";
import type { ResticEnv } from "../types";

export const addCommonArgs = (
	args: string[],
	env: ResticEnv,
	config?: RepositoryConfig,
	options?: { skipBandwidth?: boolean; includeJson?: boolean },
) => {
	if (options?.includeJson !== false) {
		args.push("--json");
	}

	if (env._SFTP_SSH_ARGS) {
		args.push("-o", `sftp.args=${env._SFTP_SSH_ARGS}`);
	}

	if (env.AWS_S3_BUCKET_LOOKUP === "dns") {
		args.push("-o", "s3.bucket-lookup=dns");
	}

	if (env._INSECURE_TLS === "true") {
		args.push("--insecure-tls");
	}

	if (env.RESTIC_CACERT) {
		args.push("--cacert", env.RESTIC_CACERT);
	}

	if (config && !options?.skipBandwidth) {
		const uploadLimit = formatBandwidthLimit(config.uploadLimit);
		if (uploadLimit) {
			args.push("--limit-upload", uploadLimit);
		}

		const downloadLimit = formatBandwidthLimit(config.downloadLimit);
		if (downloadLimit) {
			args.push("--limit-download", downloadLimit);
		}
	}
};
