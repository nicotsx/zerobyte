import { useSuspenseQuery } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, ArrowUpDown, Database, Plus, RotateCcw } from "lucide-react";
import { useState } from "react";
import { listRepositoriesOptions } from "~/client/api-client/@tanstack/react-query.gen";
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

type SortColumn = "name" | "backend" | "status" | "compression";
type SortDirection = "asc" | "desc";
type RepositoryRow = {
	id: string;
	shortId: string;
	name: string;
	type: RepositoryBackend;
	status: string | null;
	compressionMode?: string | null;
};

const getSortValue = (column: SortColumn, repository: RepositoryRow) => {
	switch (column) {
		case "name":
			return repository.name;
		case "backend":
			return repository.type;
		case "status":
			return repository.status || "";
		case "compression":
			return repository.compressionMode || "";
	}
};

export function RepositoriesPage() {
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
		...listRepositoriesOptions(),
	});

	const repositories = data as RepositoryRow[];

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

	const filteredRepositories = repositories.filter((repository) => {
		const matchesSearch = repository.name.toLowerCase().includes(searchQuery.toLowerCase());
		const matchesStatus = !statusFilter || repository.status === statusFilter;
		const matchesBackend = !backendFilter || repository.type === backendFilter;
		return matchesSearch && matchesStatus && matchesBackend;
	});

	const sortedFilteredRepositories = [...filteredRepositories].sort((a, b) => {
		const valueA = getSortValue(sortColumn, a).toLowerCase();
		const valueB = getSortValue(sortColumn, b).toLowerCase();
		const result = valueA.localeCompare(valueB);

		return sortDirection === "asc" ? result : -result;
	});

	const hasNoRepositories = repositories.length === 0;
	const hasNoFilteredRepositories = sortedFilteredRepositories.length === 0 && !hasNoRepositories;

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
							<SelectItem value="healthy">Healthy</SelectItem>
							<SelectItem value="error">Error</SelectItem>
							<SelectItem value="unknown">Unknown</SelectItem>
						</SelectContent>
					</Select>
					<Select value={backendFilter} onValueChange={setBackendFilter}>
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
					{(searchQuery || statusFilter || backendFilter) && (
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
						<TableRow>
							<TableHead className="w-25 uppercase">
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
							<TableHead className="uppercase hidden sm:table-cell">
								<Button
									type="button"
									variant="ghost"
									onClick={() => toggleSort("compression")}
									className="h-auto! p-0! font-inherit hover:bg-transparent uppercase group/sort"
								>
									Compresison
									<div className="lg:invisible lg:group-hover/sort:visible">{renderSortIcon("compression")}</div>
								</Button>
							</TableHead>
							<TableHead className="uppercase text-center">
								<Button
									type="button"
									variant="ghost"
									onClick={() => toggleSort("status")}
									className="h-auto! w-full! p-0! font-inherit hover:bg-transparent uppercase group/sort relative"
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
						{sortedFilteredRepositories.map((repository) => (
							<TableRow
								key={repository.id}
								className="hover:bg-accent/50 hover:cursor-pointer h-12"
								onClick={() => navigate({ to: `/repositories/${repository.shortId}` })}
							>
								<TableCell className="font-medium text-strong-accent">
									<div className="flex items-center gap-2">
										<span>{repository.name}</span>
									</div>
								</TableCell>
								<TableCell>
									<span className="flex items-center gap-2 text-muted-foreground">
										<RepositoryIcon backend={repository.type} />
										{repository.type}
									</span>
								</TableCell>
								<TableCell className="hidden sm:table-cell">
									<span className="text-muted-foreground text-xs bg-primary/10 rounded-md px-2 py-1">
										{repository.compressionMode || "off"}
									</span>
								</TableCell>
								<TableCell className="text-center">
									<StatusDot
										variant={
											repository.status === "healthy" ? "success" : repository.status === "error" ? "error" : "warning"
										}
										label={
											repository.status ? repository.status[0].toUpperCase() + repository.status.slice(1) : "Unknown"
										}
									/>
								</TableCell>
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
						<span className="text-strong-accent">{sortedFilteredRepositories.length}</span> repositor
						{sortedFilteredRepositories.length === 1 ? "y" : "ies"}
					</span>
				)}
			</div>
		</Card>
	);
}
