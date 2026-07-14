import type { MouseEvent } from "react";
import {
	Pagination,
	PaginationContent,
	PaginationEllipsis,
	PaginationItem,
	PaginationLink,
	PaginationNext,
	PaginationPrevious,
} from "~/client/components/ui/pagination";
import { cn } from "~/client/lib/utils";
import type { TaskLogKind, TaskLogOutcome } from "./task-log-shared";

type PaginationEntry = number | "ellipsis-start" | "ellipsis-end";

export const getTaskLogPagination = (page: number, totalPages: number): PaginationEntry[] => {
	if (totalPages <= 5) return Array.from({ length: totalPages }, (_, index) => index + 1);
	if (page <= 3) return [1, 2, 3, "ellipsis-end", totalPages];
	if (page >= totalPages - 2) {
		return [1, "ellipsis-start", totalPages - 2, totalPages - 1, totalPages];
	}
	return [1, "ellipsis-start", page, "ellipsis-end", totalPages];
};

const buildTaskLogHref = (page: number, kind?: TaskLogKind, outcome?: TaskLogOutcome) => {
	const search = new URLSearchParams();
	if (kind) search.set("kind", kind);
	if (outcome) search.set("outcome", outcome);
	if (page > 1) search.set("page", String(page));
	const query = search.toString();
	return query ? `/task-log?${query}` : "/task-log";
};

export function TaskLogPagination({
	page,
	totalPages,
	kind,
	outcome,
	onPageChange,
}: {
	page: number;
	totalPages: number;
	kind?: TaskLogKind;
	outcome?: TaskLogOutcome;
	onPageChange: (page: number) => void;
}) {
	const goToPage = (event: MouseEvent<HTMLAnchorElement>, nextPage: number) => {
		if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
		event.preventDefault();
		if (nextPage === page || nextPage < 1 || nextPage > totalPages) return;
		onPageChange(nextPage);
	};
	const previousPage = Math.max(1, page - 1);
	const nextPage = Math.min(totalPages, page + 1);

	return (
		<Pagination className="mx-0 w-auto justify-start sm:justify-end">
			<PaginationContent>
				<PaginationItem>
					<PaginationPrevious
						href={page > 1 ? buildTaskLogHref(previousPage, kind, outcome) : undefined}
						aria-disabled={page === 1}
						tabIndex={page === 1 ? -1 : undefined}
						className={cn({ "pointer-events-none opacity-40": page === 1 })}
						onClick={(event) => goToPage(event, previousPage)}
					/>
				</PaginationItem>
				{getTaskLogPagination(page, totalPages).map((entry) => (
					<PaginationItem key={entry}>
						{typeof entry === "number" ? (
							<PaginationLink
								href={buildTaskLogHref(entry, kind, outcome)}
								isActive={entry === page}
								aria-label={`Go to page ${entry}`}
								onClick={(event) => goToPage(event, entry)}
							>
								{entry}
							</PaginationLink>
						) : (
							<PaginationEllipsis />
						)}
					</PaginationItem>
				))}
				<PaginationItem>
					<PaginationNext
						href={page < totalPages ? buildTaskLogHref(nextPage, kind, outcome) : undefined}
						aria-disabled={page === totalPages}
						tabIndex={page === totalPages ? -1 : undefined}
						className={cn({ "pointer-events-none opacity-40": page === totalPages })}
						onClick={(event) => goToPage(event, nextPage)}
					/>
				</PaginationItem>
			</PaginationContent>
		</Pagination>
	);
}
