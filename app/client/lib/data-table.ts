import {
	columnFilteringFeature,
	columnVisibilityFeature,
	createFilteredRowModel,
	createSortedRowModel,
	filterFn_includesString,
	rowSortingFeature,
	sortFn_alphanumeric,
	sortFn_text,
	tableFeatures,
} from "@tanstack/react-table";

export const dataTableFeatures = tableFeatures({
	columnFilteringFeature,
	columnVisibilityFeature,
	filteredRowModel: createFilteredRowModel(),
	filterFns: { includesString: filterFn_includesString },
	rowSortingFeature,
	sortedRowModel: createSortedRowModel(),
	sortFns: {
		alphanumeric: sortFn_alphanumeric,
		text: sortFn_text,
	},
});
