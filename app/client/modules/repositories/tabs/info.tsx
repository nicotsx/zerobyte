import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { useNavigate } from "react-router";
import { Check, Save } from "lucide-react";
import { Card } from "~/client/components/ui/card";
import { Button } from "~/client/components/ui/button";
import { Input } from "~/client/components/ui/input";
import { Label } from "~/client/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "~/client/components/ui/select";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "~/client/components/ui/alert-dialog";
import type { Repository } from "~/client/lib/types";
import { slugify } from "~/client/lib/utils";
import { updateRepositoryMutation } from "~/client/api-client/@tanstack/react-query.gen";
import type { UpdateRepositoryResponse } from "~/client/api-client/types.gen";
import type { CompressionMode } from "~/schemas/restic";

type Props = {
	repository: Repository;
};

export const RepositoryInfoTabContent = ({ repository }: Props) => {
	const navigate = useNavigate();
	const [name, setName] = useState(repository.name);
	const [compressionMode, setCompressionMode] = useState<CompressionMode>(
		(repository.compressionMode as CompressionMode) || "off",
	);
	const [showConfirmDialog, setShowConfirmDialog] = useState(false);

	const updateMutation = useMutation({
		...updateRepositoryMutation(),
		onSuccess: (data: UpdateRepositoryResponse) => {
			toast.success("Repository updated successfully");
			setShowConfirmDialog(false);

			if (data.name !== repository.name) {
				navigate(`/repositories/${data.name}`);
			}
		},
		onError: (error) => {
			toast.error("Failed to update repository", { description: error.message, richColors: true });
			setShowConfirmDialog(false);
		},
	});

	const handleSubmit = (e: React.FormEvent) => {
		e.preventDefault();
		setShowConfirmDialog(true);
	};

	const confirmUpdate = () => {
		updateMutation.mutate({
			path: { name: repository.name },
			body: { name, compressionMode },
		});
	};

	const hasChanges =
		name !== repository.name || compressionMode !== ((repository.compressionMode as CompressionMode) || "off");

	return (
		<>
			<Card className="p-6">
				<form onSubmit={handleSubmit} className="space-y-6">
					<div>
						<h3 className="text-lg font-semibold mb-4">Repository Settings</h3>
						<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
							<div className="space-y-2">
								<Label htmlFor="name">Name</Label>
								<Input
									id="name"
									value={name}
									onChange={(e) => setName(slugify(e.target.value))}
									placeholder="Repository name"
									maxLength={32}
									minLength={2}
								/>
								<p className="text-sm text-muted-foreground">Unique identifier for the repository.</p>
							</div>
							<div className="space-y-2">
								<Label htmlFor="compressionMode">Compression mode</Label>
								<Select value={compressionMode} onValueChange={(val) => setCompressionMode(val as CompressionMode)}>
									<SelectTrigger id="compressionMode">
										<SelectValue placeholder="Select compression mode" />
									</SelectTrigger>
									<SelectContent>
										<SelectItem value="off">Off</SelectItem>
										<SelectItem value="auto">Auto</SelectItem>
										<SelectItem value="max">Max</SelectItem>
									</SelectContent>
								</Select>
								<p className="text-sm text-muted-foreground">Compression level for new data.</p>
							</div>
						</div>
					</div>

					<div>
						<h3 className="text-lg font-semibold mb-4">Repository Information</h3>
						<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
							<div>
								<div className="text-sm font-medium text-muted-foreground">Backend</div>
								<p className="mt-1 text-sm">{repository.type}</p>
							</div>
							<div>
								<div className="text-sm font-medium text-muted-foreground">Status</div>
								<p className="mt-1 text-sm">{repository.status || "unknown"}</p>
							</div>
							<div>
								<div className="text-sm font-medium text-muted-foreground">Created at</div>
								<p className="mt-1 text-sm">{new Date(repository.createdAt).toLocaleString()}</p>
							</div>
							<div>
								<div className="text-sm font-medium text-muted-foreground">Last checked</div>
								<p className="mt-1 text-sm">
									{repository.lastChecked ? new Date(repository.lastChecked).toLocaleString() : "Never"}
								</p>
							</div>
						</div>
					</div>

					{repository.lastError && (
						<div>
							<div className="flex items-center justify-between mb-4">
								<h3 className="text-lg font-semibold text-red-500">Last Error</h3>
							</div>
							<div className="bg-red-500/10 border border-red-500/20 rounded-md p-4">
								<p className="text-sm text-red-500">{repository.lastError}</p>
							</div>
						</div>
					)}

					<div>
						<h3 className="text-lg font-semibold mb-4">Configuration</h3>
						<div className="bg-muted/50 rounded-md p-4">
							<pre className="text-sm overflow-auto">{JSON.stringify(repository.config, null, 2)}</pre>
						</div>
					</div>

					<div className="flex justify-end pt-4 border-t">
						<Button type="submit" disabled={!hasChanges || updateMutation.isPending} loading={updateMutation.isPending}>
							<Save className="h-4 w-4 mr-2" />
							Save Changes
						</Button>
					</div>
				</form>
			</Card>

			<AlertDialog open={showConfirmDialog} onOpenChange={setShowConfirmDialog}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Update repository</AlertDialogTitle>
						<AlertDialogDescription>Are you sure you want to update the repository settings?</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>Cancel</AlertDialogCancel>
						<AlertDialogAction onClick={confirmUpdate}>
							<Check className="h-4 w-4" />
							Update
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</>
	);
};
