import type { HTMLAttributes } from "react";

const baseClassName =
	"bg-card text-card-foreground group relative border border-border shadow-[0_8px_30px_-15px_rgba(0,0,0,0.04)] transition-colors duration-300 dark:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.02)]";

export function CornerCard({ children, className, ...props }: HTMLAttributes<HTMLDivElement>) {
	return (
		<div {...props} className={`${baseClassName}${className ? ` ${className}` : ""}`}>
			<span
				aria-hidden="true"
				className="pointer-events-none absolute inset-0 z-10 select-none opacity-30 transition-opacity duration-300"
			>
				<span className="absolute -left-0.5 -top-0.5 h-0.5 w-4 bg-foreground" />
				<span className="absolute -left-0.5 -top-0.5 h-4 w-0.5 bg-foreground" />
				<span className="absolute -right-0.5 -top-0.5 h-0.5 w-4 bg-foreground" />
				<span className="absolute -right-0.5 -top-0.5 h-4 w-0.5 bg-foreground" />
				<span className="absolute -left-0.5 -bottom-0.5 h-0.5 w-4 bg-foreground" />
				<span className="absolute -left-0.5 -bottom-0.5 h-4 w-0.5 bg-foreground" />
				<span className="absolute -right-0.5 -bottom-0.5 h-0.5 w-4 bg-foreground" />
				<span className="absolute -right-0.5 -bottom-0.5 h-4 w-0.5 bg-foreground" />
			</span>
			{children}
		</div>
	);
}
