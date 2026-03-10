import { Database, HardDrive, Cloud, Server } from "lucide-react";
import type { RepositoryBackend } from "@zerobyte/core/restic";

type Props = {
	backend: RepositoryBackend;
	className?: string;
};

export const RepositoryIcon = ({ backend, className = "h-4 w-4" }: Props) => {
	switch (backend) {
		case "local":
			return <HardDrive className={className} />;
		case "s3":
			return <Cloud className={className} />;
		case "gcs":
			return <Cloud className={className} />;
		case "rest":
		case "sftp":
			return <Server className={className} />;
		default:
			return <Database className={className} />;
	}
};
