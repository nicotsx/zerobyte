import type React from "react";

interface CodeBlockProps {
	code: string;
	language?: string;
	filename?: string;
}

export const CodeBlock: React.FC<CodeBlockProps> = ({ code, filename }) => {
	return (
		<div className="overflow-hidden rounded-sm bg-card-header ring-1 ring-white/10">
			<div className="flex items-center justify-between border-b border-white/10 px-4 py-2 text-xs">
				<div className="flex items-center gap-1.5">
					<span className="h-2.5 w-2.5 rounded-full bg-rose-500" />
					<span className="h-2.5 w-2.5 rounded-full bg-amber-500" />
					<span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />
					{filename && <span className="ml-3 font-medium">{filename}</span>}
				</div>
			</div>
			<pre className="text-xs m-0 px-4 py-2 bg-card-header">
				<code className="text-white/80 select-all">{code}</code>
			</pre>
		</div>
	);
};
