import type { ReactNode } from "react";
import { cn } from "~/client/lib/utils";

interface GridBackgroundProps {
	children: ReactNode;
	className?: string;
	containerClassName?: string;
}

export function GridBackground({ children, className, containerClassName }: GridBackgroundProps) {
	return (
		<div
			className={cn(
				"relative min-h-full w-full",
				"bg-size-[20px_20px] sm:bg-size-[40px_40px]",
				"bg-[linear-gradient(to_right,#e4e4e7_1px,transparent_1px),linear-gradient(to_bottom,#e4e4e7_1px,transparent_1px)]",
				"dark:bg-[linear-gradient(to_right,#262626_1px,transparent_1px),linear-gradient(to_bottom,#262626_1px,transparent_1px)]",
				containerClassName,
			)}
		>
			<div className={cn("relative container m-auto", className)}>{children}</div>
		</div>
	);
}
