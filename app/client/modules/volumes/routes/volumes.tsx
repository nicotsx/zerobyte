import { useSuspenseQuery } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, ArrowUpDown, HardDrive, Plus, RotateCcw } from "lucide-react";
import { useState } from "react";
import { EmptyState } from "~/client/components/empty-state";
import { StatusDot } from "~/client/components/status-dot";
import { Button } from "~/client/components/ui/button";
import { Card } from "~/client/components/ui/card";
import { Input } from "~/client/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "~/client/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "~/client/components/ui/table";
import { VolumeIcon } from "~/client/components/volume-icon";
import { listVolumesOptions } from "~/client/api-client/@tanstack/react-query.gen";
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

type SortColumn = "name" | "backend" | "status";
type SortDirection = "asc" | "desc";
type VolumeRow = {
	shortId: string;
	name: string;
	type: "directory" | "nfs" | "smb" | "webdav" | "sftp" | "rclone";
	status: VolumeStatus;
};

const getSortValue = (column: SortColumn, volume: VolumeRow) => {
	switch (column) {
		case "name":
			return volume.name;
		case "backend":
			return volume.type;
		case "status":
			return volume.status;
	}
};

export function VolumesPage() {
	const [searchQuery, setSearchQuery] = useState("");
	const [statusFilter, setStatusFilter] = useState("");
	const [backendFilter, setBackendFilter] = useState("");
	const [sortColumn, setSortColumn] = useState<SortColumn>("name");
	const [sortDirection, setSortDirection] = useState<SortDirection>("asc");

	const clearFilters = () => {
		setSearchQuery("");
		setStatusFilter("");
		setBackendFilter("");
	};

	const navigate = useNavigate();

	const { data } = useSuspenseQuery({
		...listVolumesOptions(),
	});

	const volumes = data as VolumeRow[];

	const toggleSort = (column: SortColumn) => {
		if (sortColumn === column) {
			setSortDirection((prev) => (prev === "asc" ? "desc" : "asc"));
			return;
		}

		setSortColumn(column);
		setSortDirection("asc");
	};

	const renderSortIcon = (column: SortColumn) => {
		if (sortColumn !== column) {
			return <ArrowUpDown className="ml-2 h-3.5 w-3.5" />;
		}

		return sortDirection === "asc" ? (
			<ArrowUp className="ml-2 h-3.5 w-3.5" />
		) : (
			<ArrowDown className="ml-2 h-3.5 w-3.5" />
		);
	};

	const filteredVolumes =
		volumes.filter((volume) => {
			const matchesSearch = volume.name.toLowerCase().includes(searchQuery.toLowerCase());
			const matchesStatus = !statusFilter || volume.status === statusFilter;
			const matchesBackend = !backendFilter || volume.type === backendFilter;
			return matchesSearch && matchesStatus && matchesBackend;
		}) || [];

	const sortedFilteredVolumes = [...filteredVolumes].sort((a, b) => {
		const valueA = getSortValue(sortColumn, a).toLowerCase();
		const valueB = getSortValue(sortColumn, b).toLowerCase();
		const result = valueA.localeCompare(valueB);

		return sortDirection === "asc" ? result : -result;
	});

	const hasNoVolumes = volumes.length === 0;
	const hasNoFilteredVolumes = sortedFilteredVolumes.length === 0 && !hasNoVolumes;

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

	return (
		<Card className="p-0 gap-0">
			<div className="flex flex-col lg:flex-row items-stretch lg:items-center gap-2 md:justify-between p-4 bg-card-header py-4">
				<span className="flex flex-col sm:flex-row items-stretch md:items-center gap-2 flex-wrap">
					<Input
						className="w-full lg:w-45 min-w-45"
						placeholder="Search…"
						value={searchQuery}
						onChange={(e) => setSearchQuery(e.target.value)}
					/>
					<Select value={statusFilter} onValueChange={setStatusFilter}>
						<SelectTrigger className="w-full lg:w-45 min-w-45">
							<SelectValue placeholder="All status" />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value="mounted">Mounted</SelectItem>
							<SelectItem value="unmounted">Unmounted</SelectItem>
							<SelectItem value="error">Error</SelectItem>
						</SelectContent>
					</Select>
					<Select value={backendFilter} onValueChange={setBackendFilter}>
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
					{(searchQuery || statusFilter || backendFilter) && (
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
						<TableRow>
							<TableHead className="w-25 uppercase group/sort">
								<Button
									type="button"
									variant="ghost"
									onClick={() => toggleSort("name")}
									className="h-auto! p-0! font-inherit hover:bg-transparent uppercase group/sort"
								>
									Name
									<div className="lg:invisible lg:group-hover/sort:visible">{renderSortIcon("name")}</div>
								</Button>
							</TableHead>
							<TableHead className="uppercase text-left">
								<Button
									type="button"
									variant="ghost"
									onClick={() => toggleSort("backend")}
									className="h-auto! p-0! font-inherit hover:bg-transparent uppercase group/sort"
								>
									Backend
									<div className="lg:invisible lg:group-hover/sort:visible">{renderSortIcon("backend")}</div>
								</Button>
							</TableHead>
							<TableHead className="uppercase text-center">
								<Button
									type="button"
									variant="ghost"
									onClick={() => toggleSort("status")}
									className="h-auto! p-0! font-inherit hover:bg-transparent uppercase group/sort relative"
								>
									<span className="relative flex w-full items-center justify-center">
										Status
										<span className="lg:absolute lg:-right-6 lg:top-1/2 lg:-translate-y-1/2 lg:invisible lg:group-hover/sort:visible">
											{renderSortIcon("status")}
										</span>
									</span>
								</Button>
							</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						<TableRow className={cn({ hidden: !hasNoFilteredVolumes })}>
							<TableCell colSpan={4} className="text-center py-12">
								<div className="flex flex-col items-center gap-3">
									<p className="text-muted-foreground">No volumes match your filters.</p>
									<Button onClick={clearFilters} variant="outline" size="sm">
										<RotateCcw className="h-4 w-4 mr-2" />
										Clear filters
									</Button>
								</div>
							</TableCell>
						</TableRow>
						{sortedFilteredVolumes.map((volume) => (
							<TableRow
								key={volume.shortId}
								className="hover:bg-muted/50 hover:cursor-pointer transition-colors h-12"
								onClick={() => navigate({ to: `/volumes/${volume.shortId}` })}
							>
								<TableCell className="font-medium font-mono text-strong-accent">
									<div className="flex items-center gap-2">
										<span>{volume.name}</span>
									</div>
								</TableCell>
								<TableCell className="font-mono text-muted-foreground">
									<VolumeIcon backend={volume.type} />
								</TableCell>
								<TableCell className="text-center font-mono">
									<StatusDot
										variant={getVolumeStatusVariant(volume.status)}
										label={volume.status[0].toUpperCase() + volume.status.slice(1)}
									/>
								</TableCell>
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
						<span className="text-strong-accent font-bold">{sortedFilteredVolumes.length}</span> volume
						{sortedFilteredVolumes.length > 1 ? "s" : ""}
					</span>
				)}
			</div>
		</Card>
	);
}
