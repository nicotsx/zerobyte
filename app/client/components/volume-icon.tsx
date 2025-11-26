import { Cloud, Folder, Server, Share2 } from "lucide-react";
import type { BackendType } from "~/schemas/volumes";

type VolumeIconProps = {
	backend: BackendType;
	size?: number;
};

const getIconAndColor = (backend: BackendType) => {
	switch (backend) {
		case "directory":
			return {
				icon: Folder,
				color: "text-blue-600 dark:text-blue-400",
				label: "Directory",
			};
		case "nfs":
			return {
				icon: Server,
				color: "text-orange-600 dark:text-orange-400",
				label: "NFS",
			};
		case "smb":
			return {
				icon: Share2,
				color: "text-purple-600 dark:text-purple-400",
				label: "SMB",
			};
		case "webdav":
			return {
				icon: Cloud,
				color: "text-green-600 dark:text-green-400",
				label: "WebDAV",
			};
		default:
			return {
				icon: Folder,
				color: "text-gray-600 dark:text-gray-400",
				label: "Unknown",
			};
	}
};

export const VolumeIcon = ({ backend }: VolumeIconProps) => {
	const { icon: Icon, label } = getIconAndColor(backend);

	return (
		<span className={`flex items-center gap-2 rounded-md px-2 py-1`}>
			<Icon className="h-4 w-4" />
			{label}
		</span>
	);
};
