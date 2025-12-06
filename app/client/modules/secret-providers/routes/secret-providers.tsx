import { useQuery } from "@tanstack/react-query";
import { FileKey, KeyRound, Lock, Plus, RotateCcw, Terminal } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router";
import { StatusDot } from "~/client/components/status-dot";
import { Button } from "~/client/components/ui/button";
import { Card } from "~/client/components/ui/card";
import { Input } from "~/client/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "~/client/components/ui/select";
import { SingleProviderBrowserDialog } from "~/client/components/ui/secret-browser-dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "~/client/components/ui/table";
import { getApiV1SecretProviders } from "~/client/api-client";
import { getApiV1SecretProvidersOptions } from "~/client/api-client/@tanstack/react-query.gen";
import type { GetApiV1SecretProvidersResponse } from "~/client/api-client/types.gen";
import { SECRET_PROVIDER_METADATA, BUILTIN_PROVIDER_METADATA, type SecretProviderType } from "~/schemas/secrets";

type SecretProvider = GetApiV1SecretProvidersResponse["providers"][number];

export const handle = {
	breadcrumb: () => [{ label: "Settings", href: "/settings" }, { label: "Secret Providers" }],
};

export function meta() {
	return [
		{ title: "Zerobyte - Secret Providers" },
		{
			name: "description",
			content: "Manage external secret providers for secure credential storage.",
		},
	];
}

export const clientLoader = async (): Promise<SecretProvider[]> => {
	const result = await getApiV1SecretProviders();
	if (result.data) return result.data.providers;
	return [];
};



/**
 * Icon mapping for built-in providers (React components can't be in shared schema)
 */
const BUILTIN_PROVIDER_ICONS: Record<string, typeof Terminal> = {
	env: Terminal,
	file: FileKey,
	native: Lock,
};

interface SecretProvidersProps {
	loaderData: SecretProvider[];
}

export default function SecretProviders({ loaderData }: SecretProvidersProps) {
	const [searchQuery, setSearchQuery] = useState("");
	const [typeFilter, setTypeFilter] = useState("");
	const [statusFilter, setStatusFilter] = useState("");
	const [browseProvider, setBrowseProvider] = useState<(typeof BUILTIN_PROVIDER_METADATA)[number] | null>(null);

	const clearFilters = () => {
		setSearchQuery("");
		setTypeFilter("");
		setStatusFilter("");
	};

	const navigate = useNavigate();

	const { data } = useQuery({
		...getApiV1SecretProvidersOptions(),
		initialData: { providers: loaderData },
		select: (data) => data.providers,
	});

	const filteredProviders = (data ?? []).filter((provider: SecretProvider) => {
		const matchesSearch = provider.name.toLowerCase().includes(searchQuery.toLowerCase());
		const matchesType = !typeFilter || provider.type === typeFilter;
		const matchesStatus = !statusFilter || (statusFilter === "enabled" ? provider.enabled : !provider.enabled);
		return matchesSearch && matchesType && matchesStatus;
	});

	const hasNoProviders = (data?.length ?? 0) === 0;
	const hasNoFilteredProviders = filteredProviders.length === 0 && !hasNoProviders;

	return (
		<div className="space-y-8">
			{/* Built-in Providers Section */}
			<div className="space-y-4">
				<div className="space-y-1">
					<h2 className="text-lg font-semibold">Built-in Providers</h2>
					<p className="text-sm text-muted-foreground">
						These providers are always available and require no configuration.
					</p>
				</div>
				<div className="grid gap-4 md:grid-cols-3">
					{BUILTIN_PROVIDER_METADATA.map((provider) => {
						const Icon = BUILTIN_PROVIDER_ICONS[provider.id] ?? Lock;
						return (
							<Card
								key={provider.id}
								className={`p-4 ${provider.browsable ? "cursor-pointer hover:border-primary/50 transition-colors" : ""}`}
								onClick={provider.browsable ? () => setBrowseProvider(provider) : undefined}
							>
								<div className="flex items-start gap-3">
									<div className="rounded-md bg-muted p-2">
										<Icon className="h-5 w-5 text-muted-foreground" />
									</div>
									<div className="flex-1 space-y-1">
										<h3 className="font-medium text-sm">{provider.name}</h3>
										<p className="text-xs text-muted-foreground">{provider.description}</p>
										<code className="text-xs bg-muted px-1.5 py-0.5 rounded">{provider.prefix}</code>
									</div>
								</div>
								<div className="mt-3 flex items-end justify-between">
									<p className="text-xs text-muted-foreground italic">{provider.example}</p>
									{provider.browsable && (
										<span className="text-xs text-muted-foreground hover:text-foreground">Click to browse</span>
									)}
								</div>
							</Card>
						);
					})}
				</div>

				{/* Browse dialog for built-in providers */}
				{browseProvider && (
					<SingleProviderBrowserDialog
						open={!!browseProvider}
						onOpenChange={(open) => !open && setBrowseProvider(null)}
						providerId={browseProvider.id}
						providerName={browseProvider.name}
						providerScheme={browseProvider.prefix.replace("://", "")}
					/>
				)}
			</div>

			{/* Configurable Providers Section */}
			<div className="space-y-4">
				<div className="flex items-center justify-between">
					<div className="space-y-1">
						<h2 className="text-lg font-semibold">External Providers</h2>
						<p className="text-sm text-muted-foreground">Connect external secret management services.</p>
					</div>
				</div>

				{hasNoProviders ? (
					<Card className="p-0">
						<div className="flex flex-col items-center justify-center p-8 text-center">
							<KeyRound className="h-12 w-12 text-muted-foreground mb-4" />
							<p className="text-muted-foreground mb-4">No external providers configured</p>
							<Button onClick={() => navigate("/settings/secret-providers/create")}>
								<Plus size={16} className="mr-2" />
								Add Provider
							</Button>
						</div>
					</Card>
				) : (
					<Card className="p-0 gap-0">
						<div className="flex flex-col lg:flex-row items-stretch lg:items-center gap-2 md:justify-between p-4 bg-card-header py-4">
							<span className="flex flex-col sm:flex-row items-stretch md:items-center gap-0 flex-wrap">
								<Input
									className="w-full lg:w-[180px] min-w-[180px] -mr-px -mt-px"
									placeholder="Search providers…"
									value={searchQuery}
									onChange={(e) => setSearchQuery(e.target.value)}
								/>
								<Select value={typeFilter} onValueChange={setTypeFilter}>
									<SelectTrigger className="w-full lg:w-[180px] min-w-[180px] -mr-px -mt-px">
										<SelectValue placeholder="All types" />
									</SelectTrigger>
									<SelectContent>
										<SelectItem value="op-connect">1Password Connect</SelectItem>
									</SelectContent>
								</Select>
								<Select value={statusFilter} onValueChange={setStatusFilter}>
									<SelectTrigger className="w-full lg:w-[140px] min-w-[140px] -mr-px -mt-px">
										<SelectValue placeholder="All statuses" />
									</SelectTrigger>
									<SelectContent>
										<SelectItem value="enabled">Enabled</SelectItem>
										<SelectItem value="disabled">Disabled</SelectItem>
									</SelectContent>
								</Select>
								{(searchQuery || typeFilter || statusFilter) && (
									<Button variant="secondary" onClick={clearFilters} className="-mr-px -mt-px">
										<RotateCcw size={16} className="mr-2" />
										Clear
									</Button>
								)}
							</span>
							<Button onClick={() => navigate("/settings/secret-providers/create")}>
								<Plus size={16} className="mr-2" />
								Add Provider
							</Button>
						</div>

						{hasNoFilteredProviders ? (
							<div className="flex flex-col items-center justify-center p-8 text-center">
								<KeyRound className="h-12 w-12 text-muted-foreground mb-4" />
								<p className="text-muted-foreground">No providers match your filters</p>
								<Button variant="link" onClick={clearFilters}>
									Clear filters
								</Button>
							</div>
						) : (
							<Table>
								<TableHeader>
									<TableRow>
										<TableHead>Name</TableHead>
										<TableHead>Type</TableHead>
										<TableHead>URI Prefix</TableHead>
										<TableHead>Status</TableHead>
										<TableHead>Health</TableHead>
									</TableRow>
								</TableHeader>
								<TableBody>
									{filteredProviders.map((provider: SecretProvider) => (
										<TableRow
											key={provider.id}
											className="cursor-pointer"
											onClick={() => navigate(`/settings/secret-providers/${provider.id}`)}
										>
											<TableCell className="font-medium">{provider.name}</TableCell>
											<TableCell>{SECRET_PROVIDER_METADATA[provider.type as SecretProviderType]?.label || provider.type}</TableCell>
											<TableCell>
												<code className="text-xs bg-muted px-1.5 py-0.5 rounded">{provider.uriPrefix}</code>
											</TableCell>
											<TableCell>
												<span
													className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
														provider.enabled
															? "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400"
															: "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-400"
													}`}
												>
													{provider.enabled ? "Enabled" : "Disabled"}
												</span>
											</TableCell>
											<TableCell>
												<StatusDot
													variant={
														provider.healthStatus === "healthy"
															? "success"
															: provider.healthStatus === "unhealthy"
																? "error"
																: "neutral"
													}
													label={provider.healthStatus}
												/>
											</TableCell>
										</TableRow>
									))}
								</TableBody>
							</Table>
						)}
					</Card>
				)}
			</div>
		</div>
	);
}
