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
import { HardDrive, Plus, RotateCcw } from "lucide-react";
import { useState } from "react";
import { listVolumesOptions } from "~/client/api-client/@tanstack/react-query.gen";
import { DataTableSortHeader } from "~/client/components/data-table-sort-header";
import { EmptyState } from "~/client/components/empty-state";
import { StatusDot } from "~/client/components/status-dot";
import { Button } from "~/client/components/ui/button";
import { Card } from "~/client/components/ui/card";
import { Input } from "~/client/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "~/client/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "~/client/components/ui/table";
import { VolumeIcon } from "~/client/components/volume-icon";
import type { VolumeStatus } from "~/client/lib/types";
import { useNavigate } from "@tanstack/react-router";
import { cn } from "~/client/lib/utils";

const getVolumeStatusVariant = (status: VolumeStatus): "success" | "neutral" | "error" | "warning" => {
	const statusMap = {
		mounted: "success" as const,
		unmounted: "neutral" as const,
		error: "error" as const,
		unknown: "warning" as const,
	};
	return statusMap[status];
};

type VolumeRow = {
	shortId: string;
	name: string;
	type: "directory" | "nfs" | "smb" | "webdav" | "sftp" | "rclone";
	status: VolumeStatus;
};

const volumeColumns: ColumnDef<VolumeRow>[] = [
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
		cell: ({ row }) => <VolumeIcon backend={row.original.type} />,
		filterFn: (row, id, value) => row.getValue(id) === value,
	},
	{
		accessorKey: "status",
		header: ({ column }) => (
			<DataTableSortHeader column={column} title="Status" sortDirection={column.getIsSorted()} center />
		),
		cell: ({ row }) => <StatusDot variant={getVolumeStatusVariant(row.original.status)} label={row.original.status} />,
		filterFn: (row, id, value) => row.getValue(id) === value,
	},
];

export function VolumesPage() {
	const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
	const [sorting, setSorting] = useState<SortingState>([]);

	const navigate = useNavigate();
	const { data } = useSuspenseQuery({ ...listVolumesOptions() });

	const table = useReactTable({
		data,
		columns: volumeColumns,
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

	const hasNoVolumes = data.length === 0;
	const hasNoFilteredVolumes = rows.length === 0 && !hasNoVolumes;

	if (hasNoVolumes) {
		return (
			<EmptyState
				icon={HardDrive}
				title="No volume"
				description="Manage and monitor all your storage backends in one place with advanced features like automatic mounting and health checks."
				button={
					<Button onClick={() => navigate({ to: "/volumes/create" })}>
						<Plus size={16} className="mr-2" />
						Create Volume
					</Button>
				}
			/>
		);
	}

	const search = (table.getColumn("name")?.getFilterValue() as string) ?? "";
	const status = (table.getColumn("status")?.getFilterValue() as string) ?? "";
	const type = (table.getColumn("type")?.getFilterValue() as string) ?? "";

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
							<SelectItem value="mounted">Mounted</SelectItem>
							<SelectItem value="unmounted">Unmounted</SelectItem>
							<SelectItem value="error">Error</SelectItem>
						</SelectContent>
					</Select>
					<Select value={type} onValueChange={(value) => table.getColumn("type")?.setFilterValue(value)}>
						<SelectTrigger className="w-full lg:w-45 min-w-45">
							<SelectValue placeholder="All backends" />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value="directory">Directory</SelectItem>
							<SelectItem value="nfs">NFS</SelectItem>
							<SelectItem value="smb">SMB</SelectItem>
							<SelectItem value="webdav">WebDAV</SelectItem>
							<SelectItem value="sftp">SFTP</SelectItem>
							<SelectItem value="rclone">rclone</SelectItem>
						</SelectContent>
					</Select>
					{hasFilters && (
						<Button onClick={clearFilters} className="w-full lg:w-auto mt-2 lg:mt-0 lg:ml-2">
							<RotateCcw className="h-4 w-4 mr-2" />
							Clear filters
						</Button>
					)}
				</span>
				<Button onClick={() => navigate({ to: "/volumes/create" })}>
					<Plus size={16} className="mr-2" />
					Create Volume
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
						<TableRow className={cn({ hidden: !hasNoFilteredVolumes })}>
							<TableCell colSpan={3} className="text-center py-12">
								<div className="flex flex-col items-center gap-3">
									<p className="text-muted-foreground">No volumes match your filters.</p>
									<Button onClick={clearFilters} variant="outline" size="sm">
										<RotateCcw className="h-4 w-4 mr-2" />
										Clear filters
									</Button>
								</div>
							</TableCell>
						</TableRow>
						{rows.map((row) => (
							<TableRow
								key={row.original.shortId}
								className="hover:bg-muted/50 hover:cursor-pointer transition-colors h-12"
								onClick={() => navigate({ to: `/volumes/${row.original.shortId}` })}
							>
								{row.getVisibleCells().map((cell) => (
									<TableCell
										key={cell.id}
										className={cn("font-mono", {
											"font-medium text-strong-accent": cell.column.id === "name",
											"text-muted-foreground": cell.column.id === "type",
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
			<div className="px-4 py-2 text-sm text-muted-foreground bg-card-header flex justify-end border-t font-mono">
				{hasNoFilteredVolumes ? (
					"No volumes match filters."
				) : (
					<span className="font-mono">
						<span className="text-strong-accent font-bold">{rows.length}</span> volume
						{rows.length > 1 ? "s" : ""}
					</span>
				)}
			</div>
		</Card>
	);
}
