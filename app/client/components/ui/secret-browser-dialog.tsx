import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight, ChevronDown, KeyRound, FolderOpen, File, Server, Variable, Loader2 } from "lucide-react";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "./dialog";
import { Button } from "./button";
import { ScrollArea } from "./scroll-area";
import { cn } from "~/client/lib/utils";
import { getApiV1SecretProvidersIdBrowse, getApiV1SecretProviders } from "~/client/api-client";

/**
 * Types for the secret browser
 */
export type SecretBrowserNode = {
	id: string;
	name: string;
	type: "vault" | "item" | "field" | "folder" | "variable";
	uri?: string;
	hasChildren?: boolean;
	children?: SecretBrowserNode[];
};

export type BrowsableProvider = {
	id: string;
	name: string;
	scheme: string;
	icon: React.ReactNode;
};

/**
 * Built-in providers that are always available
 * IDs and schemes match BUILTIN_SECRET_SCHEMES from server
 */
const BUILTIN_PROVIDERS: BrowsableProvider[] = [
	{
		id: "env",
		name: "Environment Variables",
		scheme: "env",
		icon: <Variable className="h-4 w-4" />,
	},
	{
		id: "file",
		name: "File Secrets",
		scheme: "file",
		icon: <File className="h-4 w-4" />,
	},
];

/**
 * Get icon for a node type
 */
function getNodeIcon(type: SecretBrowserNode["type"]) {
	switch (type) {
		case "vault":
			return <FolderOpen className="h-4 w-4" />;
		case "item":
			return <Server className="h-4 w-4" />;
		case "field":
			return <KeyRound className="h-4 w-4" />;
		case "folder":
			return <FolderOpen className="h-4 w-4" />;
		case "variable":
			return <Variable className="h-4 w-4" />;
	}
}

interface TreeNodeProps {
	node: SecretBrowserNode;
	providerId: string;
	path: string;
	level: number;
	selectedUri: string | null;
	onSelect: (uri: string | null) => void;
	selectable?: boolean;
}

/**
 * Recursive tree node component
 */
function TreeNode({ node, providerId, path, level, selectedUri, onSelect, selectable = true }: TreeNodeProps) {
	const [expanded, setExpanded] = React.useState(false);

	const nodePath = path ? `${path}/${node.name}` : node.name;

	// Fetch children when expanded
	const { data: children, isLoading } = useQuery({
		queryKey: ["secret-browser", providerId, nodePath],
		queryFn: async () => {
			const result = await getApiV1SecretProvidersIdBrowse({
				path: { id: providerId },
				query: { path: nodePath },
			});
			const data = result.data as { nodes: SecretBrowserNode[] } | undefined;
			return data?.nodes ?? [];
		},
		enabled: expanded && node.hasChildren,
	});

	const isSelected = selectable && node.uri === selectedUri;
	const canSelect = selectable && !!node.uri;

	const handleClick = () => {
		if (node.hasChildren) {
			setExpanded(!expanded);
		}
		if (canSelect) {
			onSelect(node.uri!);
		}
	};

	return (
		<div className="min-w-0 w-full">
			<button
				type="button"
				className={cn(
					"flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm text-left hover:bg-accent hover:text-accent-foreground overflow-hidden",
					isSelected && "bg-accent text-accent-foreground",
					!canSelect && !node.hasChildren && "cursor-default opacity-60",
				)}
				style={{ paddingLeft: `${level * 16 + 8}px` }}
				onClick={handleClick}
			>
				{/* Expand/collapse indicator */}
				<span className="w-4 h-4 flex items-center justify-center shrink-0">
					{node.hasChildren ? (
						isLoading ? (
							<Loader2 className="h-3 w-3 animate-spin" />
						) : expanded ? (
							<ChevronDown className="h-3 w-3" />
						) : (
							<ChevronRight className="h-3 w-3" />
						)
					) : null}
				</span>

				{/* Node icon */}
				<span className="shrink-0 text-muted-foreground">{getNodeIcon(node.type)}</span>

				{/* Node name */}
				<span className="text-left">{node.name}</span>

				{/* URI indicator for selectable nodes */}
				{node.uri && selectable && (
					<span className="ml-auto text-xs text-muted-foreground shrink-0">
						<KeyRound className="h-3 w-3" />
					</span>
				)}
			</button>

			{/* Children */}
			{expanded && children && children.length > 0 && (
				<div>
					{children.map((child) => (
						<TreeNode
							key={child.id}
							node={child}
							providerId={providerId}
							path={nodePath}
							level={level + 1}
							selectedUri={selectedUri}
							onSelect={onSelect}
							selectable={selectable}
						/>
					))}
				</div>
			)}
		</div>
	);
}

interface ProviderBrowserProps {
	provider: BrowsableProvider;
	selectedUri: string | null;
	onSelect: (uri: string | null) => void;
	selectable?: boolean;
}

/**
 * Provider browser - shows tree of secrets for a single provider
 */
function ProviderBrowser({ provider, selectedUri, onSelect, selectable = true }: ProviderBrowserProps) {
	const [expanded, setExpanded] = React.useState(false);

	// Fetch root nodes when expanded
	const { data: nodes, isLoading, error } = useQuery({
		queryKey: ["secret-browser", provider.id, ""],
		queryFn: async () => {
			const result = await getApiV1SecretProvidersIdBrowse({
				path: { id: provider.id },
			});
			const data = result.data as { nodes: SecretBrowserNode[] } | undefined;
			return data?.nodes ?? [];
		},
		enabled: expanded,
	});

		return (
		<div className="border rounded-md overflow-hidden">
			<button
				type="button"
				className={cn(
					"flex w-full items-center gap-2 px-3 py-2 text-sm font-medium hover:bg-accent hover:text-accent-foreground rounded-t-md overflow-hidden",
					expanded && "border-b",
				)}
				onClick={() => setExpanded(!expanded)}
			>
				<span className="w-4 h-4 flex items-center justify-center shrink-0">
					{expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
				</span>
				<span className="shrink-0 text-muted-foreground">{provider.icon}</span>
				<span className="truncate min-w-0">{provider.name}</span>
				<span className="ml-auto text-xs text-muted-foreground font-mono shrink-0">{provider.scheme}://</span>
			</button>
			{expanded && (
				<div className="overflow-x-auto w-full">
					<ScrollArea className="h-[200px] w-full">
						{isLoading ? (
							<div className="flex items-center justify-center py-8">
								<Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
							</div>
						) : error ? (
							<div className="p-4 text-sm text-destructive">
								Failed to load secrets: {(error as Error).message}
							</div>
						) : nodes && nodes.length > 0 ? (
							<div className="py-1 w-full">
								{nodes.map((node) => (
									<TreeNode
										key={node.id}
										node={node}
										providerId={provider.id}
										path=""
										level={0}
										selectedUri={selectedUri}
										onSelect={onSelect}
										selectable={selectable}
									/>
								))}
							</div>
						) : (
							<div className="p-4 text-sm text-muted-foreground">No secrets available</div>
						)}
					</ScrollArea>
				</div>
			)}
		</div>
	);
}

export interface SecretBrowserDialogProps {
	/** Whether the dialog is open */
	open: boolean;
	/** Callback when dialog open state changes */
	onOpenChange: (open: boolean) => void;
	/** Callback when a secret is selected (only in selectable mode) */
	onSelect?: (uri: string) => void;
	/** Whether secrets can be selected (false = browse-only mode) */
	selectable?: boolean;
	/** Only show built-in providers (env, file) - hide external providers */
	builtInOnly?: boolean;
	/** Dialog title override */
	title?: string;
	/** Dialog description override */
	description?: string;
}

/**
 * SecretBrowserDialog - A dialog for browsing and optionally selecting secrets from providers
 *
 * Used in two contexts:
 * 1. In forms with SecretInput - to select a secret URI to fill the input (selectable=true)
 * 2. In provider details - to browse available secrets structure (selectable=false)
 */
export function SecretBrowserDialog({
	open,
	onOpenChange,
	onSelect,
	selectable = true,
	builtInOnly = false,
	title = selectable ? "Select Secret" : "Browse Secrets",
	description = selectable
		? "Browse and select a secret from configured providers."
		: "Browse available secrets from this provider.",
}: SecretBrowserDialogProps) {
	const [selectedUri, setSelectedUri] = React.useState<string | null>(null);

	// Fetch configured providers from DB (skip if builtInOnly)
	const { data: dbProviders } = useQuery({
		queryKey: ["getApiV1SecretProviders"],
		queryFn: async () => {
			const result = await getApiV1SecretProviders();
			return result.data?.providers ?? [];
		},
		enabled: open && !builtInOnly,
	});

	// Build list of all providers (built-in + DB configured)
	const allProviders = React.useMemo(() => {
		const providers: BrowsableProvider[] = [...BUILTIN_PROVIDERS];

		// Add DB providers (unless builtInOnly)
		if (!builtInOnly && dbProviders) {
			for (const p of dbProviders) {
				if (p.enabled) {
					providers.push({
						id: String(p.id),
						name: p.name,
						scheme: p.uriPrefix.replace("://", ""),
						icon: <Server className="h-4 w-4" />,
					});
				}
			}
		}

		return providers;
	}, [dbProviders, builtInOnly]);

	const handleSelect = () => {
		if (selectedUri && onSelect) {
			onSelect(selectedUri);
			onOpenChange(false);
			setSelectedUri(null);
		}
	};

	const handleCancel = () => {
		onOpenChange(false);
		setSelectedUri(null);
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-[700px]">
				<DialogHeader>
					<DialogTitle>{title}</DialogTitle>
					<DialogDescription>{description}</DialogDescription>
				</DialogHeader>

				<div className="space-y-3 py-4">
					{allProviders.map((provider) => (
						<ProviderBrowser
							key={provider.id}
							provider={provider}
							selectedUri={selectedUri}
							onSelect={setSelectedUri}
							selectable={selectable}
						/>
					))}
				</div>

				<DialogFooter>
					<Button variant="secondary" onClick={handleCancel}>
						{selectable ? "Cancel" : "Close"}
					</Button>
					{selectable && (
						<Button onClick={handleSelect} disabled={!selectedUri}>
							Select
						</Button>
					)}
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

/**
 * Simplified dialog for browsing a single provider's secrets
 * Used in provider detail pages
 */
export interface SingleProviderBrowserDialogProps {
	/** Whether the dialog is open */
	open: boolean;
	/** Callback when dialog open state changes */
	onOpenChange: (open: boolean) => void;
	/** Provider ID */
	providerId: string;
	/** Provider name */
	providerName: string;
	/** Provider scheme */
	providerScheme: string;
}

export function SingleProviderBrowserDialog({
	open,
	onOpenChange,
	providerId,
	providerName,
	providerScheme,
}: SingleProviderBrowserDialogProps) {
	const provider: BrowsableProvider = {
		id: providerId,
		name: providerName,
		scheme: providerScheme,
		icon: <Server className="h-4 w-4" />,
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-[700px]">
				<DialogHeader>
					<DialogTitle>Browse Secrets - {providerName}</DialogTitle>
					<DialogDescription>
						View available secrets from this provider. Use the URI reference in your configuration.
					</DialogDescription>
				</DialogHeader>

				<div className="py-4">
					<ProviderBrowser
						provider={provider}
						selectedUri={null}
						onSelect={() => {}}
						selectable={false}
					/>
				</div>

				<DialogFooter>
					<Button variant="secondary" onClick={() => onOpenChange(false)}>
						Close
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
