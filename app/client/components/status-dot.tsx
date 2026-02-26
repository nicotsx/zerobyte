import { cn } from "~/client/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";

type StatusVariant = "success" | "neutral" | "error" | "warning" | "info";

interface StatusDotProps {
	variant: StatusVariant;
	label: string;
	animated?: boolean;
}

export const StatusDot = ({ variant, label, animated }: StatusDotProps) => {
	const statusMapping = {
		success: {
			color: "bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]",
			colorLight: "bg-emerald-400",
			animated: animated ?? true,
		},
		neutral: {
			color: "bg-gray-500",
			colorLight: "bg-gray-400",
			animated: animated ?? false,
		},
		error: {
			color: "bg-red-500",
			colorLight: "bg-red-400",
			animated: animated ?? true,
		},
		warning: {
			color: "bg-yellow-500",
			colorLight: "bg-yellow-400",
			animated: animated ?? true,
		},
		info: {
			color: "bg-blue-500",
			colorLight: "bg-blue-400",
			animated: animated ?? true,
		},
	}[variant];

	return (
		<Tooltip>
			<TooltipTrigger>
				<span className="relative flex size-3 mx-auto">
					{statusMapping?.animated && (
						<span
							className={cn(
								"absolute inline-flex h-full w-full animate-[ping_3s_cubic-bezier(0,0,0.2,1)_infinite] rounded-full opacity-50",
								`${statusMapping.colorLight}`,
							)}
						/>
					)}
					<span className={cn("relative inline-flex size-3 rounded-full", `${statusMapping?.color}`)} />
				</span>
			</TooltipTrigger>
			<TooltipContent>
				<p>{label}</p>
			</TooltipContent>
		</Tooltip>
	);
};
