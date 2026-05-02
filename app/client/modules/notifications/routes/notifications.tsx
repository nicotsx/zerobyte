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
import { Bell, Plus, RotateCcw } from "lucide-react";
import { useState } from "react";
import { listNotificationDestinationsOptions } from "~/client/api-client/@tanstack/react-query.gen";
import { DataTableSortHeader } from "~/client/components/data-table-sort-header";
import { EmptyState } from "~/client/components/empty-state";
import { StatusDot } from "~/client/components/status-dot";
import { Button } from "~/client/components/ui/button";
import { Card } from "~/client/components/ui/card";
import { Input } from "~/client/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "~/client/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "~/client/components/ui/table";
import { useNavigate } from "@tanstack/react-router";
import { cn } from "~/client/lib/utils";

type NotificationRow = {
	id: number;
	name: string;
	type: "email" | "slack" | "discord" | "gotify" | "ntfy" | "pushover" | "telegram" | "custom" | "generic";
	enabled: boolean;
	status: "healthy" | "error" | "unknown";
};

const getNotificationStatus = (row: NotificationRow) => (row.enabled ? row.status : "disabled");
const getNotificationStatusVariant = (row: NotificationRow) => {
	if (!row.enabled) return "neutral";
	if (row.status === "healthy") return "success";
	if (row.status === "error") return "error";
	return "warning";
};

const notificationColumns: ColumnDef<NotificationRow>[] = [
	{
		accessorKey: "name",
		header: ({ column }) => <DataTableSortHeader column={column} title="Name" sortDirection={column.getIsSorted()} />,
		cell: ({ row }) => row.original.name,
	},
	{
		accessorKey: "type",
		header: ({ column }) => <DataTableSortHeader column={column} title="Type" sortDirection={column.getIsSorted()} />,
		cell: ({ row }) => row.original.type,
		filterFn: (row, id, value) => row.getValue(id) === value,
	},
	{
		accessorFn: getNotificationStatus,
		id: "status",
		header: ({ column }) => (
			<DataTableSortHeader column={column} title="Status" sortDirection={column.getIsSorted()} center />
		),
		cell: ({ row }) => (
			<StatusDot variant={getNotificationStatusVariant(row.original)} label={getNotificationStatus(row.original)} />
		),
		filterFn: (row, id, value) => row.getValue(id) === value,
	},
];

export function NotificationsPage() {
	const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
	const [sorting, setSorting] = useState<SortingState>([]);

	const navigate = useNavigate();

	const { data } = useSuspenseQuery({
		...listNotificationDestinationsOptions(),
	});

	const table = useReactTable({
		data,
		columns: notificationColumns,
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

	const hasNoNotifications = data.length === 0;
	const hasNoFilteredNotifications = rows.length === 0 && !hasNoNotifications;

	if (hasNoNotifications) {
		return (
			<EmptyState
				icon={Bell}
				title="No notification destinations"
				description="Set up notification channels to receive alerts when your backups complete or fail."
				button={
					<Button onClick={() => navigate({ to: "/notifications/create" })}>
						<Plus size={16} className="mr-2" />
						Create Destination
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
					<Select value={type} onValueChange={(value) => table.getColumn("type")?.setFilterValue(value)}>
						<SelectTrigger className="w-full lg:w-45 min-w-45">
							<SelectValue placeholder="All types" />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value="email">Email</SelectItem>
							<SelectItem value="slack">Slack</SelectItem>
							<SelectItem value="discord">Discord</SelectItem>
							<SelectItem value="gotify">Gotify</SelectItem>
							<SelectItem value="ntfy">Ntfy</SelectItem>
							<SelectItem value="pushover">Pushover</SelectItem>
							<SelectItem value="telegram">Telegram</SelectItem>
							<SelectItem value="generic">Generic</SelectItem>
							<SelectItem value="custom">Custom</SelectItem>
						</SelectContent>
					</Select>
					<Select value={status} onValueChange={(value) => table.getColumn("status")?.setFilterValue(value)}>
						<SelectTrigger className="w-full lg:w-45 min-w-45">
							<SelectValue placeholder="All status" />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value="healthy">Healthy</SelectItem>
							<SelectItem value="error">Error</SelectItem>
							<SelectItem value="unknown">Unknown</SelectItem>
							<SelectItem value="disabled">Disabled</SelectItem>
						</SelectContent>
					</Select>
					{hasFilters && (
						<Button onClick={clearFilters} className="w-full lg:w-auto mt-2 lg:mt-0 lg:ml-2">
							<RotateCcw className="h-4 w-4 mr-2" />
							Clear filters
						</Button>
					)}
				</span>
				<Button onClick={() => navigate({ to: "/notifications/create" })}>
					<Plus size={16} className="mr-2" />
					Create Destination
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
						<TableRow className={cn({ hidden: !hasNoFilteredNotifications })}>
							<TableCell colSpan={3} className="text-center py-12">
								<div className="flex flex-col items-center gap-3">
									<p className="text-muted-foreground">No destinations match your filters.</p>
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
								onClick={() => navigate({ to: `/notifications/${row.original.id}` })}
							>
								{row.getVisibleCells().map((cell) => (
									<TableCell
										key={cell.id}
										className={cn({
											"font-medium text-strong-accent": cell.column.id === "name",
											"capitalize text-muted-foreground": cell.column.id === "type",
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
				{hasNoFilteredNotifications ? (
					"No destinations match filters."
				) : (
					<span>
						<span className="text-strong-accent">{rows.length}</span> destination
						{rows.length !== 1 ? "s" : ""}
					</span>
				)}
			</div>
		</Card>
	);
}
