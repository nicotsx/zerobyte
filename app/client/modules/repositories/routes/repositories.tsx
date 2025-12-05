import { useQuery } from "@tanstack/react-query";
import { Database, Plus, RotateCcw } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router";
import { listRepositories } from "~/client/api-client/sdk.gen";
import { listRepositoriesOptions } from "~/client/api-client/@tanstack/react-query.gen";
import { RepositoryIcon } from "~/client/components/repository-icon";
import { Button } from "~/client/components/ui/button";
import { Card } from "~/client/components/ui/card";
import { Input } from "~/client/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "~/client/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "~/client/components/ui/table";
import type { Route } from "./+types/repositories";
import { cn } from "~/client/lib/utils";
import { EmptyState } from "~/client/components/empty-state";

export const handle = {
	breadcrumb: () => [{ label: "Repositories" }],
};

export function meta(_: Route.MetaArgs) {
	return [
		{ title: "Zerobyte - Repositories" },
		{
			name: "description",
			content: "Manage your backup repositories with encryption and compression.",
		},
	];
}

export const clientLoader = async () => {
	const repositories = await listRepositories();
	if (repositories.data) return repositories.data;
	return [];
};

export default function Repositories({ loaderData }: Route.ComponentProps) {
	const [searchQuery, setSearchQuery] = useState("");
	const [statusFilter, setStatusFilter] = useState("");
	const [backendFilter, setBackendFilter] = useState("");

	const clearFilters = () => {
		setSearchQuery("");
		setStatusFilter("");
		setBackendFilter("");
	};

	const navigate = useNavigate();

	const { data } = useQuery({
		...listRepositoriesOptions(),
		initialData: loaderData,
	});

	const filteredRepositories =
		data?.filter((repository) => {
			const matchesSearch = repository.name.toLowerCase().includes(searchQuery.toLowerCase());
			const matchesStatus = !statusFilter || repository.status === statusFilter;
			const matchesBackend = !backendFilter || repository.type === backendFilter;
			return matchesSearch && matchesStatus && matchesBackend;
		}) || [];

	const hasNoRepositories = data?.length === 0;
	const hasNoFilteredRepositories = filteredRepositories.length === 0 && !hasNoRepositories;

	if (hasNoRepositories) {
		return (
			<EmptyState
				icon={Database}
				title="No repository"
				description="Repositories are remote storage locations where you can backup your volumes securely. Encrypted and optimized for storage efficiency."
				button={
					<Button onClick={() => navigate("/repositories/create")}>
						<Plus size={16} className="mr-2" />
						Create Repository
					</Button>
				}
			/>
		);
	}

	return (
		<Card className="p-0 gap-0">
			<div className="flex flex-col lg:flex-row items-stretch lg:items-center gap-2 md:justify-between p-4 bg-card-header py-4">
				<span className="flex flex-col sm:flex-row items-stretch md:items-center gap-0 flex-wrap ">
					<Input
						className="w-full lg:w-[180px] min-w-[180px] -mr-px -mt-px"
						placeholder="Search repositories…"
						value={searchQuery}
						onChange={(e) => setSearchQuery(e.target.value)}
					/>
					<Select value={statusFilter} onValueChange={setStatusFilter}>
						<SelectTrigger className="w-full lg:w-[180px] min-w-[180px] -mr-px -mt-px">
							<SelectValue placeholder="All status" />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value="healthy">Healthy</SelectItem>
							<SelectItem value="error">Error</SelectItem>
							<SelectItem value="unknown">Unknown</SelectItem>
						</SelectContent>
					</Select>
					<Select value={backendFilter} onValueChange={setBackendFilter}>
						<SelectTrigger className="w-full lg:w-[180px] min-w-[180px] -mt-px">
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
				<Button onClick={() => navigate("/repositories/create")}>
					<Plus size={16} className="mr-2" />
					Create Repository
				</Button>
			</div>
			<div className="overflow-x-auto">
				<Table className="border-t">
					<TableHeader className="bg-card-header">
						<TableRow>
							<TableHead className="w-[100px] uppercase">Name</TableHead>
							<TableHead className="uppercase text-left">Backend</TableHead>
							<TableHead className="uppercase hidden sm:table-cell">Compression</TableHead>
							<TableHead className="uppercase text-center">Status</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{hasNoFilteredRepositories ? (
							<TableRow>
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
						) : (
							filteredRepositories.map((repository) => (
								<TableRow
									key={repository.name}
									className="hover:bg-accent/50 hover:cursor-pointer"
									onClick={() => navigate(`/repositories/${repository.name}`)}
								>
									<TableCell className="font-medium text-strong-accent">{repository.name}</TableCell>
									<TableCell>
										<span className="flex items-center gap-2">
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
										<span
											className={cn(
												"inline-flex items-center gap-2 px-2 py-1 rounded-md text-xs bg-gray-500/10 text-gray-500",
												{
													"bg-green-500/10 text-green-500": repository.status === "healthy",
													"bg-red-500/10 text-red-500": repository.status === "error",
												},
											)}
										>
											{repository.status || "unknown"}
										</span>
									</TableCell>
								</TableRow>
							))
						)}
					</TableBody>
				</Table>
			</div>
			<div className="px-4 py-2 text-sm text-muted-foreground bg-card-header flex justify-end border-t">
				{hasNoFilteredRepositories ? (
					"No repositories match filters."
				) : (
					<span>
						<span className="text-strong-accent">{filteredRepositories.length}</span> repositor
						{filteredRepositories.length === 1 ? "y" : "ies"}
					</span>
				)}
			</div>
		</Card>
	);
}
