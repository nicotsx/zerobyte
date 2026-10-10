import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { browseFilesystemOptions } from "~/client/api-client/@tanstack/react-query.gen";
import { FolderSelector } from "~/client/components/folder-selector";
import { Label } from "~/client/components/ui/label";
import { Button } from "~/client/components/ui/button";

type Props = {
	id: string;
	agentId: string;
	rootId: string;
	rootLabel: string;
	selectedPath: string | null;
	active?: boolean;
	error?: string;
	onSelect: (path: string) => void;
	onVerificationChange: (isVerified: boolean) => void;
};

export const TrustedRootBrowser = ({
	id,
	agentId,
	rootId,
	rootLabel,
	selectedPath,
	active = true,
	error,
	onSelect,
	onVerificationChange,
}: Props) => {
	const path = selectedPath ?? "";

	const query = useQuery({
		...browseFilesystemOptions({ query: { agentId, rootId, path } }),
		enabled: active,
		refetchOnMount: "always",
	});

	const verified = active && query.isSuccess && !query.isError && !query.isFetching && query.data.path === path;
	const verificationFailed = query.isError || (query.isSuccess && !query.isFetching && !verified && active);
	const message = verificationFailed
		? "Could not load folders from this location. Retry or choose another folder."
		: error;
	const descriptionId = id + "-description";
	const errorId = id + "-error";

	useEffect(() => {
		onVerificationChange(verified);
	}, [verified, onVerificationChange]);

	return (
		<div aria-label={`Browse ${rootLabel}`} className="grid gap-2">
			<Label htmlFor={id}>Folder</Label>
			<FolderSelector
				id={id}
				aria-describedby={`${descriptionId}${message ? ` ${errorId}` : ""}`}
				aria-invalid={!!message}
				remote={{ agentId, rootId }}
				value={selectedPath === null ? "" : `/${selectedPath}`}
				displayValue={
					selectedPath === null
						? undefined
						: selectedPath === ""
							? `Entire ${rootLabel}`
							: `${rootLabel}/${selectedPath}`
				}
				buttonLabel={selectedPath === null ? "Choose folder" : "Change"}
				onChange={(value) => onSelect(value.replace(/^\//, ""))}
			/>
			<p id={descriptionId} className="text-xs text-muted-foreground">
				Choose this entire location or a subfolder.
			</p>
			{message && (
				<div className="space-y-2">
					<p id={errorId} role="alert" data-slot="form-message" className="text-sm text-destructive">
						{message}
					</p>
					{verificationFailed && (
						<Button
							type="button"
							variant="outline"
							size="sm"
							loading={query.isFetching}
							onClick={() => void query.refetch()}
						>
							Retry loading folder
						</Button>
					)}
				</div>
			)}
		</div>
	);
};
