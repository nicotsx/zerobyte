import { useState } from "react";
import { DirectoryBrowser } from "./directory-browser";
import { Button } from "./ui/button";

type Props = {
	value: string;
	onChange: (path: string) => void;
	label?: string;
};

/**
 * A reusable path selector component that shows the selected path
 * with a "Change" button, and expands to a DirectoryBrowser when clicked.
 * Matches the pattern used in the volume creation form.
 */
export const PathSelector = ({ value, onChange, label = "Selected path:" }: Props) => {
	const [showBrowser, setShowBrowser] = useState(false);

	if (showBrowser) {
		return (
			<div className="space-y-2">
				<DirectoryBrowser
					onSelectPath={(path) => {
						onChange(path);
						setShowBrowser(false);
					}}
					selectedPath={value}
				/>
				<Button
					type="button"
					variant="ghost"
					size="sm"
					onClick={() => setShowBrowser(false)}
				>
					Cancel
				</Button>
			</div>
		);
	}

	return (
		<div className="flex items-center gap-2">
			<div className="flex-1 border rounded-md p-3 bg-muted/50">
				<div className="text-xs font-medium text-muted-foreground mb-1">{label}</div>
				<div className="text-sm font-mono break-all">{value}</div>
			</div>
			<Button type="button" variant="outline" size="sm" onClick={() => setShowBrowser(true)}>
				Change
			</Button>
		</div>
	);
};
