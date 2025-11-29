import { useState } from "react";
import { DirectoryBrowser } from "./directory-browser";
import { Button } from "./ui/button";

type Props = {
	value: string;
	onChange: (path: string) => void;
	label?: string;
};

export const PathSelector = ({ value, onChange }: Props) => {
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
				<Button type="button" variant="ghost" size="sm" onClick={() => setShowBrowser(false)}>
					Cancel
				</Button>
			</div>
		);
	}

	console.log("Rendering PathSelector with value:", value);
	return (
		<div className="flex items-center gap-2">
			<div className="flex-1 text-sm font-mono bg-muted px-3 py-2 rounded-md border">{value}</div>
			<Button type="button" variant="outline" onClick={() => setShowBrowser(true)} size="sm">
				Change
			</Button>
		</div>
	);
};
