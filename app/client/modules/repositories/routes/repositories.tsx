import { useSuspenseQuery } from "@tanstack/react-query";
import {
	flexRender,
	getCoreRowModel,
	getFilteredRowModel,
	getSortedRowModel,
	type ColumnDef,
	type ColumnFiltersState,
	type SortingState,
	useReactTable,
} from "@tanstack/react-table";
import { Database, Plus, RotateCcw } from "lucide-react";
import { useState } from "react";
import { listRepositoriesOptions } from "~/client/api-client/@tanstack/react-query.gen";
import { DataTableSortHeader } from "~/client/components/data-table-sort-header";
import { RepositoryIcon } from "~/client/components/repository-icon";
import { Button } from "~/client/components/ui/button";
import { Card } from "~/client/components/ui/card";
import { Input } from "~/client/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "~/client/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "~/client/components/ui/table";
import { cn } from "~/client/lib/utils";
import { StatusDot } from "~/client/components/status-dot";
import { EmptyState } from "~/client/components/empty-state";
import { useNavigate } from "@tanstack/react-router";
import type { RepositoryBackend } from "@zerobyte/core/restic";

type RepositoryRow = {
	id: string;
	shortId: string;
	name: string;
	type: RepositoryBackend;
	status: string | null;
	compressionMode?: string | null;
};

const repositoryColumns: ColumnDef<RepositoryRow>[] = [
	{
		accessorKey: "name",
		header: ({ column }) => <DataTableSortHeader column={column} title="Name" sortDirection={column.getIsSorted()} />,
		cell: ({ row }) => (
			<div className="flex items-center gap-2">
				<span>{row.original.name}</span>
			</div>
		),
	},
	{
		accessorKey: "type",
		header: ({ column }) => (
			<DataTableSortHeader column={column} title="Backend" sortDirection={column.getIsSorted()} />
		),
		cell: ({ row }) => (
			<span className="flex items-center gap-2 text-muted-foreground">
				<RepositoryIcon backend={row.original.type} />
				{row.original.type}
			</span>
		),
		filterFn: (row, id, value) => row.getValue(id) === value,
	},
	{
		accessorFn: (row) => row.compressionMode || "off",
		id: "compressionMode",
		header: ({ column }) => (
			<DataTableSortHeader column={column} title="Compression" sortDirection={column.getIsSorted()} />
		),
		cell: ({ row }) => (
			<span className="text-muted-foreground text-xs bg-primary/10 rounded-md px-2 py-1">
				{row.original.compressionMode || "off"}
			</span>
		),
		sortingFn: "alphanumeric",
	},
	{
		accessorFn: (row) => row.status || "unknown",
		id: "status",
		header: ({ column }) => (
			<DataTableSortHeader column={column} title="Status" sortDirection={column.getIsSorted()} center />
		),
		cell: ({ row }) => (
			<StatusDot
				variant={row.original.status === "healthy" ? "success" : row.original.status === "error" ? "error" : "warning"}
				label={row.original.status || "unknown"}
			/>
		),
		sortingFn: "alphanumeric",
		filterFn: (row, id, value) => row.getValue(id) === value,
	},
];

export function RepositoriesPage() {
	const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
	const [sorting, setSorting] = useState<SortingState>([{ id: "name", desc: false }]);

	const navigate = useNavigate();

	const { data } = useSuspenseQuery({
		...listRepositoriesOptions(),
	});

	const table = useReactTable({
		data,
		columns: repositoryColumns,
		state: { columnFilters, sorting },
		onColumnFiltersChange: setColumnFilters,
		onSortingChange: setSorting,
		getCoreRowModel: getCoreRowModel(),
		getFilteredRowModel: getFilteredRowModel(),
		getSortedRowModel: getSortedRowModel(),
	});
	const rows = table.getRowModel().rows;
	const hasFilters = columnFilters.length > 0;

	const clearFilters = () => table.resetColumnFilters();

	const hasNoRepositories = data.length === 0;
	const hasNoFilteredRepositories = rows.length === 0 && !hasNoRepositories;

	if (hasNoRepositories) {
		return (
			<EmptyState
				icon={Database}
				title="No repository"
				description="Repositories are remote storage locations where you can backup your volumes securely. Encrypted and optimized for storage efficiency."
				button={
					<Button onClick={() => navigate({ to: "/repositories/create" })}>
						<Plus size={16} className="mr-2" />
						Create repository
					</Button>
				}
			/>
		);
	}

	const search = (table.getColumn("name")?.getFilterValue() as string) ?? "";
	const type = (table.getColumn("type")?.getFilterValue() as string) ?? "";
	const status = (table.getColumn("status")?.getFilterValue() as string) ?? "";

	return (
		<Card className="p-0 gap-0">
			<div className="flex flex-col lg:flex-row items-stretch lg:items-center gap-2 md:justify-between p-4 bg-card-header py-4">
				<span className="flex flex-col sm:flex-row items-stretch md:items-center gap-2 flex-wrap">
					<Input
						className="w-full lg:w-45 min-w-45"
						placeholder="Search…"
						value={search}
						onChange={(e) => table.getColumn("name")?.setFilterValue(e.target.value)}
					/>
					<Select value={status} onValueChange={(value) => table.getColumn("status")?.setFilterValue(value)}>
						<SelectTrigger className="w-full lg:w-45 min-w-45">
							<SelectValue placeholder="All status" />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value="healthy">Healthy</SelectItem>
							<SelectItem value="error">Error</SelectItem>
							<SelectItem value="unknown">Unknown</SelectItem>
						</SelectContent>
					</Select>
					<Select value={type} onValueChange={(value) => table.getColumn("type")?.setFilterValue(value)}>
						<SelectTrigger className="w-full lg:w-45 min-w-45">
							<SelectValue placeholder="All backends" />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value="local">Local</SelectItem>
							<SelectItem value="sftp">SFTP</SelectItem>
							<SelectItem value="s3">S3</SelectItem>
							<SelectItem value="gcs">Google Cloud Storage</SelectItem>
						</SelectContent>
					</Select>
					{hasFilters && (
						<Button onClick={clearFilters} className="w-full lg:w-auto mt-2 lg:mt-0 lg:ml-2">
							<RotateCcw className="h-4 w-4 mr-2" />
							Clear filters
						</Button>
					)}
				</span>
				<Button onClick={() => navigate({ to: "/repositories/create" })}>
					<Plus size={16} className="mr-2" />
					Create Repository
				</Button>
			</div>
			<div className="overflow-x-auto">
				<Table className="border-t">
					<TableHeader className="bg-card-header">
						{table.getHeaderGroups().map((headerGroup) => (
							<TableRow key={headerGroup.id}>
								{headerGroup.headers.map((header) => (
									<TableHead
										key={header.id}
										className={cn("uppercase", {
											"w-25": header.column.id === "name",
											"text-left": header.column.id === "type",
											"hidden sm:table-cell": header.column.id === "compressionMode",
											"text-center": header.column.id === "status",
										})}
									>
										{header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}
									</TableHead>
								))}
							</TableRow>
						))}
					</TableHeader>
					<TableBody>
						<TableRow className={cn({ hidden: !hasNoFilteredRepositories })}>
							<TableCell colSpan={4} className="text-center py-12">
								<div className="flex flex-col items-center gap-3">
									<p className="text-muted-foreground">No repositories match your filters.</p>
									<Button onClick={clearFilters} variant="outline" size="sm">
										<RotateCcw className="h-4 w-4 mr-2" />
										Clear filters
									</Button>
								</div>
							</TableCell>
						</TableRow>
						{rows.map((row) => (
							<TableRow
								key={row.original.id}
								className="hover:bg-accent/50 hover:cursor-pointer h-12"
								onClick={() => navigate({ to: `/repositories/${row.original.shortId}` })}
							>
								{row.getVisibleCells().map((cell) => (
									<TableCell
										key={cell.id}
										className={cn({
											"font-medium text-strong-accent": cell.column.id === "name",
											"hidden sm:table-cell": cell.column.id === "compressionMode",
											"text-center": cell.column.id === "status",
										})}
									>
										{flexRender(cell.column.columnDef.cell, cell.getContext())}
									</TableCell>
								))}
							</TableRow>
						))}
					</TableBody>
				</Table>
			</div>
			<div className="px-4 py-2 text-sm text-muted-foreground bg-card-header flex justify-end border-t">
				{hasNoFilteredRepositories ? (
					"No repositories match filters."
				) : (
					<span>
						<span className="text-strong-accent">{rows.length}</span> repositor
						{rows.length === 1 ? "y" : "ies"}
					</span>
				)}
			</div>
		</Card>
	);
}
