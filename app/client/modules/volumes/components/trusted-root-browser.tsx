import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { TRUSTED_ROOT_PATH_PREFIX } from "@zerobyte/contracts/volumes";
import { browseFilesystemOptions } from "~/client/api-client/@tanstack/react-query.gen";
import { FolderSelector } from "~/client/components/folder-selector";

type Props = {
	agentId: string;
	rootId: string;
	rootLabel: string;
	selectedPath: string | null;
	onSelect: (path: string) => void;
	onSelectionInvalidated: () => void;
	onVerificationChange: (isVerified: boolean) => void;
};

export const TrustedRootBrowser = ({
	agentId,
	rootId,
	rootLabel,
	selectedPath,
	onSelect,
	onSelectionInvalidated,
	onVerificationChange,
}: Props) => {
	const path = selectedPath ?? "";

	const query = useQuery(browseFilesystemOptions({ query: { agentId, rootId, path } }));

	const verified = query.isSuccess && !query.isError && query.data.path === `${TRUSTED_ROOT_PATH_PREFIX}${path}`;

	useEffect(() => {
		onVerificationChange(verified);
		if (query.isError || (query.isSuccess && !verified)) onSelectionInvalidated();
	}, [verified, query.isError, query.isSuccess, onVerificationChange, onSelectionInvalidated]);

	return (
		<div aria-label={`Browse ${rootLabel}`}>
			<FolderSelector
				remote={{ agentId, rootId }}
				value={selectedPath === null ? "" : `/${selectedPath}`}
				onChange={(value) => onSelect(value.replace(/^\//, ""))}
			/>
			{query.isError && (
				<p role="alert" className="text-sm text-destructive">
					Could not load folders from this location.
				</p>
			)}
		</div>
	);
};
