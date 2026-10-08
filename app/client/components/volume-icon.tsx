import { Cloud, Folder, Server } from "lucide-react";
import type { BackendType } from "@zerobyte/contracts/volumes";

type VolumeIconProps = {
	backend: BackendType | null;
};

const getIconAndLabel = (backend: BackendType | null) => {
	switch (backend) {
		case "directory":
			return {
				icon: Folder,
				label: "Directory",
			};
		case "nfs":
			return {
				icon: Server,
				label: "NFS",
			};
		case "smb":
			return {
				icon: Server,
				label: "SMB",
			};
		case "webdav":
			return {
				icon: Server,
				label: "WebDAV",
			};
		case "rclone":
			return {
				icon: Cloud,
				label: "Rclone",
			};
		case "sftp":
			return {
				icon: Server,
				label: "SFTP",
			};
		case null:
			return {
				icon: Folder,
				label: "Filesystem",
			};
		default:
			return {
				icon: Folder,
				label: "Unknown",
			};
	}
};

export const VolumeIcon = ({ backend }: VolumeIconProps) => {
	const { icon: Icon, label } = getIconAndLabel(backend);

	return (
		<span className={`flex items-center gap-2 rounded-md py-1`}>
			<Icon className="h-4 w-4" />
			{label}
		</span>
	);
};
