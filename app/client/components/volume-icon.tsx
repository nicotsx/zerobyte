import { Cloud, Folder, Server } from "lucide-react";
import type { BackendType } from "~/schemas/volumes";

type VolumeIconProps = {
	backend: BackendType;
};

const getIconAndLabel = (backend: BackendType) => {
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
		<span className={`flex items-center gap-2 rounded-md px-2 py-1`}>
			<Icon className="h-4 w-4" />
			{label}
		</span>
	);
};
