import type { Column } from "@tanstack/react-table";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import { Button } from "~/client/components/ui/button";
import { cn } from "~/client/lib/utils";

export function DataTableSortHeader<TData, TValue>({
	column,
	title,
	sortDirection,
	center = false,
}: {
	column: Column<TData, TValue>;
	title: string;
	sortDirection: false | "asc" | "desc";
	center?: boolean;
}) {
	const icon =
		sortDirection === "desc" ? (
			<ArrowDown className="ml-2 h-3.5 w-3.5" />
		) : sortDirection === "asc" ? (
			<ArrowUp className="ml-2 h-3.5 w-3.5" />
		) : (
			<ArrowUpDown className="ml-2 h-3.5 w-3.5" />
		);
	const iconVisibility = sortDirection ? "" : "lg:invisible lg:group-hover/sort:visible";

	if (center) {
		return (
			<Button
				type="button"
				variant="ghost"
				onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
				className="h-auto! w-full! p-0! font-inherit hover:bg-transparent uppercase group/sort relative"
			>
				<span className="relative flex w-full items-center justify-center">
					{title}
					<span className={cn("lg:absolute lg:-right-6 lg:top-1/2 lg:-translate-y-1/2", iconVisibility)}>{icon}</span>
				</span>
			</Button>
		);
	}

	return (
		<Button
			type="button"
			variant="ghost"
			onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
			className="h-auto! p-0! font-inherit hover:bg-transparent uppercase group/sort"
		>
			{title}
			<span className={iconVisibility}>{icon}</span>
		</Button>
	);
}
