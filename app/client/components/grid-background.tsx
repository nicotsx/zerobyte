import type { ReactNode } from "react";
import { cn } from "~/client/lib/utils";

interface GridBackgroundProps {
	children: ReactNode;
	className?: string;
	containerClassName?: string;
}

export function GridBackground({ children, className, containerClassName }: GridBackgroundProps) {
	return (
		<div className={cn("relative min-h-full w-full", containerClassName)}>
			<div
				className={cn(
					"pointer-events-none absolute inset-0 w-full h-full",
					"bg-[size:40px_40px]",
					"bg-[linear-gradient(to_right,#e4e4e7_1px,transparent_1px),linear-gradient(to_bottom,#e4e4e7_1px,transparent_1px)]",
					"dark:bg-[linear-gradient(to_right,#262626_1px,transparent_1px),linear-gradient(to_bottom,#262626_1px,transparent_1px)]",
					"[mask-image:radial-gradient(ellipse_at_top,black_70%,transparent_100%)]",
				)}
			/>
			<div className={cn("relative container m-auto z-10", className)}>{children}</div>
		</div>
	);
}
