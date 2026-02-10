import { useState } from "react";
import { cn } from "~/client/lib/utils";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "./ui/hover-card";

interface RetentionCategoryBadgesProps {
	categories: string[];
	className?: string;
}

const categoryColors: Record<string, string> = {
	last: "bg-blue-500/20 text-blue-700 dark:text-blue-300 border-blue-500/30",
	hourly: "bg-cyan-500/20 text-cyan-700 dark:text-cyan-300 border-cyan-500/30",
	daily: "bg-green-500/20 text-green-700 dark:text-green-300 border-green-500/30",
	weekly: "bg-orange-500/20 text-orange-700 dark:text-orange-300 border-orange-500/30",
	monthly: "bg-purple-500/20 text-purple-700 dark:text-purple-300 border-purple-500/30",
	yearly: "bg-red-500/20 text-red-700 dark:text-red-300 border-red-500/30",
};

const categoryLabels: Record<string, string> = {
	last: "Last",
	hourly: "Hourly",
	daily: "Daily",
	weekly: "Weekly",
	monthly: "Monthly",
	yearly: "Yearly",
};

function Badge({ category }: { category: string }) {
	return (
		<span
			className={cn(
				"inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border",
				categoryColors[category] || "bg-gray-500/20 text-gray-700 dark:text-gray-300 border-gray-500/30",
			)}
		>
			{categoryLabels[category] || category}
		</span>
	);
}

export function RetentionCategoryBadges({ categories, className }: RetentionCategoryBadgesProps) {
	const [open, setOpen] = useState(false);

	if (categories.length === 0) {
		return null;
	}

	const order = ["last", "hourly", "daily", "weekly", "monthly", "yearly"];
	const sortedCategories = [...categories].sort((a, b) => {
		const indexA = order.indexOf(a);
		const indexB = order.indexOf(b);
		if (indexA === -1) return 1;
		if (indexB === -1) return -1;
		return indexA - indexB;
	});

	const firstCategory = sortedCategories[0];
	const hasMore = sortedCategories.length > 1;

	if (!hasMore) {
		return (
			<div className={className}>
				<Badge category={firstCategory} />
			</div>
		);
	}

	return (
		<HoverCard open={open} onOpenChange={setOpen}>
			<HoverCardTrigger asChild>
				<button
					type="button"
					className={cn("cursor-pointer bg-transparent p-0 border-0", className)}
					aria-label={`View ${categories.length} retention categories`}
					onClick={() => setOpen(true)}
				>
					<Badge category={`${categories.length} tags`} />
				</button>
			</HoverCardTrigger>
			<HoverCardContent className="w-auto p-2">
				<div className="flex flex-wrap gap-1">
					{sortedCategories.map((category) => (
						<Badge key={category} category={category} />
					))}
				</div>
			</HoverCardContent>
		</HoverCard>
	);
}
