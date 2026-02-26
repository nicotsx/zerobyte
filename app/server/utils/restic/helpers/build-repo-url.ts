import type { RepositoryConfig } from "~/schemas/restic";

export const buildRepoUrl = (config: RepositoryConfig): string => {
	switch (config.backend) {
		case "local":
			return config.path;
		case "s3": {
			const endpoint = config.endpoint.trim().replace(/\/$/, "");
			return `s3:${endpoint}/${config.bucket}`;
		}
		case "r2": {
			const endpoint = config.endpoint
				.trim()
				.replace(/^https?:\/\//, "")
				.replace(/\/$/, "");
			return `s3:${endpoint}/${config.bucket}`;
		}
		case "gcs":
			return `gs:${config.bucket}:/`;
		case "azure":
			return `azure:${config.container}:/`;
		case "rclone":
			return `rclone:${config.remote}:${config.path}`;
		case "rest": {
			const pathSuffix = config.path ? `/${config.path}` : "";
			return `rest:${config.url}${pathSuffix}`;
		}
		case "sftp":
			return `sftp:${config.user}@${config.host}:${config.path}`;
		default: {
			throw new Error(`Unsupported repository backend: ${JSON.stringify(config)}`);
		}
	}
};
