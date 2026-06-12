import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, KeyRound, Plus, Trash2, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "~/client/components/ui/button";
import { Card, CardContent, CardDescription, CardTitle } from "~/client/components/ui/card";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "~/client/components/ui/dialog";
import { Input } from "~/client/components/ui/input";
import { Label } from "~/client/components/ui/label";
import { authClient } from "~/client/lib/auth-client";
import { logger } from "~/client/lib/logger";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "~/client/components/ui/table";
import { Badge } from "~/client/components/ui/badge";

export function ApiTokensSection() {
	const [createDialogOpen, setCreateDialogOpen] = useState(false);
	const [tokenName, setTokenName] = useState("");
	const [createdKey, setCreatedKey] = useState<string | null>(null);
	const queryClient = useQueryClient();

	const { data: apiKeysData, isLoading } = useQuery({
		queryKey: ["apiKeys"],
		queryFn: async () => {
			const result = await authClient.apiKey.list();
			return result.data;
		},
	});

	const createMutation = useMutation({
		mutationFn: async (name: string) => {
			const result = await authClient.apiKey.create({
				name,
				expiresIn: 90 * 24 * 60 * 60 * 1000, // 90 days
			});
			return result.data;
		},
		onSuccess: (data) => {
			if (data?.key) {
				setCreatedKey(data.key);
			}
			void queryClient.invalidateQueries({ queryKey: ["apiKeys"] });
			toast.success("API token created");
		},
		onError: (error) => {
			logger.error(error);
			toast.error("Failed to create API token");
		},
	});

	const deleteMutation = useMutation({
		mutationFn: async (keyId: string) => {
			await authClient.apiKey.delete({ keyId });
		},
		onSuccess: () => {
			void queryClient.invalidateQueries({ queryKey: ["apiKeys"] });
			toast.success("API token revoked");
		},
		onError: (error) => {
			logger.error(error);
			toast.error("Failed to revoke API token");
		},
	});

	const handleCreate = () => {
		if (!tokenName.trim()) {
			toast.error("Name is required");
			return;
		}
		createMutation.mutate(tokenName);
	};

	const handleCopyKey = () => {
		if (createdKey) {
			void navigator.clipboard.writeText(createdKey);
			toast.success("API token copied to clipboard");
		}
	};

	const handleCloseDialog = () => {
		setCreateDialogOpen(false);
		setTokenName("");
		setCreatedKey(null);
	};

	const handleDelete = (id: string) => {
		if (window.confirm("Are you sure you want to revoke this API token? This action cannot be undone.")) {
			deleteMutation.mutate(id);
		}
	};

	return (
		<>
			<Card className="p-0 gap-0">
				<div className="border-b border-border/50 bg-card-header p-6">
					<div className="flex items-center justify-between">
						<div>
							<CardTitle className="flex items-center gap-2">
								<KeyRound className="size-5" />
								API Tokens
							</CardTitle>
							<CardDescription className="mt-1.5">
								Manage API tokens for programmatic access to Zerobyte
							</CardDescription>
						</div>
						<Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
							<DialogTrigger asChild>
								<Button size="sm">
									<Plus className="size-4 mr-1" />
									Create Token
								</Button>
							</DialogTrigger>
							<DialogContent>
								{createdKey ? (
									<>
										<DialogHeader>
											<DialogTitle>API Token Created</DialogTitle>
											<DialogDescription>
												Copy your API token now. It will not be shown again.
											</DialogDescription>
										</DialogHeader>
										<div className="space-y-4 py-4">
											<div className="relative">
												<Input
													value={createdKey}
													readOnly
													className="font-mono text-sm pr-10"
												/>
												<Button
													variant="ghost"
													size="icon"
													className="absolute right-0 top-0 h-full px-3"
													onClick={handleCopyKey}
												>
													<Copy className="size-4" />
												</Button>
											</div>
										</div>
										<DialogFooter>
											<Button onClick={handleCloseDialog}>Done</Button>
										</DialogFooter>
									</>
								) : (
									<>
										<DialogHeader>
											<DialogTitle>Create API Token</DialogTitle>
											<DialogDescription>
												Create a new API token for programmatic access. The token will expire in
												90 days.
											</DialogDescription>
										</DialogHeader>
										<div className="space-y-4 py-4">
											<div className="space-y-2">
												<Label htmlFor="token-name">Name</Label>
												<Input
													id="token-name"
													value={tokenName}
													onChange={(e) => setTokenName(e.target.value)}
													placeholder="e.g., mcp-server, ci-cd"
												/>
											</div>
										</div>
										<DialogFooter>
											<Button variant="outline" onClick={() => setCreateDialogOpen(false)}>
												<X className="h-4 w-4 mr-2" />
												Cancel
											</Button>
											<Button onClick={handleCreate} loading={createMutation.isPending}>
												Create
											</Button>
										</DialogFooter>
									</>
								)}
							</DialogContent>
						</Dialog>
					</div>
				</div>
				<CardContent className="p-6">
					{isLoading ? (
						<p className="text-sm text-muted-foreground">Loading...</p>
					) : !apiKeysData?.apiKeys?.length ? (
						<p className="text-sm text-muted-foreground">No API tokens yet. Create one to get started.</p>
					) : (
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead>Name</TableHead>
									<TableHead>Prefix</TableHead>
									<TableHead>Created</TableHead>
									<TableHead>Expires</TableHead>
									<TableHead>Status</TableHead>
									<TableHead className="w-[70px]" />
								</TableRow>
							</TableHeader>
							<TableBody>
								{apiKeysData.apiKeys.map((key) => (
									<TableRow key={key.id}>
										<TableCell className="font-medium">{key.name || "Unnamed"}</TableCell>
										<TableCell className="font-mono text-sm">
											{key.start || key.prefix || "—"}
										</TableCell>
										<TableCell>{new Date(key.createdAt).toLocaleDateString()}</TableCell>
										<TableCell>
											{key.expiresAt ? new Date(key.expiresAt).toLocaleDateString() : "Never"}
										</TableCell>
										<TableCell>
											<Badge variant={key.enabled !== false ? "default" : "secondary"}>
												{key.enabled !== false ? "Active" : "Disabled"}
											</Badge>
										</TableCell>
										<TableCell>
											<Button variant="ghost" size="icon" onClick={() => handleDelete(key.id)}>
												<Trash2 className="size-4 text-destructive" />
											</Button>
										</TableCell>
									</TableRow>
								))}
							</TableBody>
						</Table>
					)}
				</CardContent>
			</Card>
		</>
	);
}
