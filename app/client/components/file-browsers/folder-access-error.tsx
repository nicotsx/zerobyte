import { toast } from "sonner";
import { FileWarning } from "lucide-react";

type Props = {
	message: string;
	openPrivacySettings?: () => Promise<void>;
};

export const FolderAccessError = ({ message, openPrivacySettings }: Props) => {
	const denied = /\b(EPERM|EACCES)\b/.test(message);

	return (
		<div role="alert" className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-destructive">
			<FileWarning className="size-4 shrink-0" aria-hidden="true" />
			<span>{denied ? "Access to this folder was denied." : message}</span>
			{denied && openPrivacySettings && (
				<button
					type="button"
					className="cursor-pointer text-xs underline underline-offset-2 normal-case"
					onClick={() =>
						void openPrivacySettings().catch(() => toast.error("Could not open Privacy Settings"))
					}
				>
					Open Privacy Settings
				</button>
			)}
		</div>
	);
};
