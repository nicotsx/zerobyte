import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Check, Save } from "lucide-react";
import { Card } from "~/client/components/ui/card";
import { Button } from "~/client/components/ui/button";
import { Input } from "~/client/components/ui/input";
import { Label } from "~/client/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "~/client/components/ui/select";
import { Checkbox } from "~/client/components/ui/checkbox";
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
import { updateRepositoryMutation } from "~/client/api-client/@tanstack/react-query.gen";
import type { BandwidthLimit, CompressionMode } from "~/schemas/restic";
import { BANDWIDTH_UNITS } from "~/schemas/restic";

type Props = {
	repository: Repository;
};

export const RepositoryInfoTabContent = ({ repository }: Props) => {
	const [name, setName] = useState(repository.name);
	const [compressionMode, setCompressionMode] = useState<CompressionMode>(
		(repository.compressionMode as CompressionMode) || "off",
	);
	const [showConfirmDialog, setShowConfirmDialog] = useState(false);

	// Rclone-specific state
	const isRclone = repository.type === "rclone";
	const rcloneConfig = isRclone ? (repository.config as {
		transfers?: number;
		checkers?: number;
		fastList?: boolean;
		bwlimitUpload?: BandwidthLimit;
		bwlimitDownload?: BandwidthLimit;
		additionalArgs?: string;
	}) : null;

	const [transfers, setTransfers] = useState<number | undefined>(rcloneConfig?.transfers);
	const [checkers, setCheckers] = useState<number | undefined>(rcloneConfig?.checkers);
	const [fastList, setFastList] = useState<boolean>(rcloneConfig?.fastList ?? false);
	const [bwlimitUpload, setBwlimitUpload] = useState<BandwidthLimit>(
		rcloneConfig?.bwlimitUpload ?? { enabled: false, value: 0, unit: "M" }
	);
	const [bwlimitDownload, setBwlimitDownload] = useState<BandwidthLimit>(
		rcloneConfig?.bwlimitDownload ?? { enabled: false, value: 0, unit: "M" }
	);
	const [additionalArgs, setAdditionalArgs] = useState<string>(rcloneConfig?.additionalArgs ?? "");

	const updateMutation = useMutation({
		...updateRepositoryMutation(),
		onSuccess: () => {
			toast.success("Repository updated successfully");
			setShowConfirmDialog(false);
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
		const body: Record<string, unknown> = { name, compressionMode };

		if (isRclone) {
			body.transfers = transfers;
			body.checkers = checkers;
			body.fastList = fastList;
			body.bwlimitUpload = bwlimitUpload;
			body.bwlimitDownload = bwlimitDownload;
			body.additionalArgs = additionalArgs || undefined;
		}

		updateMutation.mutate({
			path: { id: repository.id },
			body,
		});
	};

	const hasBasicChanges =
		name !== repository.name || compressionMode !== ((repository.compressionMode as CompressionMode) || "off");

	const hasRcloneChanges = isRclone && (
		transfers !== rcloneConfig?.transfers ||
		checkers !== rcloneConfig?.checkers ||
		fastList !== (rcloneConfig?.fastList ?? false) ||
		JSON.stringify(bwlimitUpload) !== JSON.stringify(rcloneConfig?.bwlimitUpload ?? { enabled: false, value: 0, unit: "M" }) ||
		JSON.stringify(bwlimitDownload) !== JSON.stringify(rcloneConfig?.bwlimitDownload ?? { enabled: false, value: 0, unit: "M" }) ||
		additionalArgs !== (rcloneConfig?.additionalArgs ?? "")
	);

	const hasChanges = hasBasicChanges || hasRcloneChanges;

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
									onChange={(e) => setName(e.target.value)}
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

					{/* Rclone-specific options */}
					{isRclone && (
						<div>
							<h3 className="text-lg font-semibold mb-4">Rclone Options</h3>
							<div className="space-y-4">
								{/* Fast List */}
								<div className="flex items-center space-x-3">
									<Checkbox
										id="fastList"
										checked={fastList}
										onCheckedChange={(checked) => setFastList(checked === true)}
									/>
									<div className="space-y-1">
										<Label htmlFor="fastList">Use Fast List</Label>
										<p className="text-sm text-muted-foreground">
											Use more memory but fewer API transactions. Reduces costs and sync time on cloud providers.
										</p>
									</div>
								</div>

								{/* Transfers and Checkers */}
								<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
									<div className="space-y-2">
										<Label htmlFor="transfers">Parallel Transfers</Label>
										<Input
											id="transfers"
											type="number"
											min={1}
											max={128}
											placeholder="4"
											className="w-24"
											value={transfers ?? ""}
											onChange={(e) => {
												const val = e.target.value;
												if (val === "") {
													setTransfers(undefined);
												} else {
													const num = Number.parseInt(val, 10);
													if (!Number.isNaN(num)) {
														setTransfers(Math.min(128, Math.max(1, num)));
													}
												}
											}}
										/>
										<p className="text-sm text-muted-foreground">File transfers in parallel (1-128). Default: 4.</p>
									</div>
									<div className="space-y-2">
										<Label htmlFor="checkers">Parallel Checkers</Label>
										<Input
											id="checkers"
											type="number"
											min={1}
											max={256}
											placeholder="8"
											className="w-24"
											value={checkers ?? ""}
											onChange={(e) => {
												const val = e.target.value;
												if (val === "") {
													setCheckers(undefined);
												} else {
													const num = Number.parseInt(val, 10);
													if (!Number.isNaN(num)) {
														setCheckers(Math.min(256, Math.max(1, num)));
													}
												}
											}}
										/>
										<p className="text-sm text-muted-foreground">File checkers in parallel (1-256). Default: 8.</p>
									</div>
								</div>

								{/* Bandwidth Limits */}
								<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
									<div className="space-y-2">
										<div className="flex items-center space-x-3 mb-2">
											<Checkbox
												id="bwlimit-upload-enabled"
												checked={bwlimitUpload.enabled}
												onCheckedChange={(checked) => {
													if (checked) {
														setBwlimitUpload({ enabled: true, value: 10, unit: "M" });
													} else {
														setBwlimitUpload({ enabled: false, value: 0, unit: "M" });
													}
												}}
											/>
											<Label htmlFor="bwlimit-upload-enabled">Upload Speed Limit</Label>
										</div>
										{bwlimitUpload.enabled && (
											<div className="flex items-center gap-2">
												<Input
													type="number"
													min={0}
													className="w-20"
													value={bwlimitUpload.value}
													onChange={(e) => {
														const val = Math.max(0, Number.parseInt(e.target.value, 10) || 0);
														setBwlimitUpload({ ...bwlimitUpload, value: val });
													}}
												/>
												<Select
													value={bwlimitUpload.unit}
													onValueChange={(val) => setBwlimitUpload({ ...bwlimitUpload, unit: val as keyof typeof BANDWIDTH_UNITS })}
												>
													<SelectTrigger className="w-24">
														<SelectValue />
													</SelectTrigger>
													<SelectContent>
														{Object.keys(BANDWIDTH_UNITS).map((unit) => (
															<SelectItem key={unit} value={unit}>
																{unit}iB/s
															</SelectItem>
														))}
													</SelectContent>
												</Select>
											</div>
										)}
										<p className="text-sm text-muted-foreground">
											{bwlimitUpload.enabled ? "Max upload speed." : "Unlimited upload speed."}
										</p>
									</div>
									<div className="space-y-2">
										<div className="flex items-center space-x-3 mb-2">
											<Checkbox
												id="bwlimit-download-enabled"
												checked={bwlimitDownload.enabled}
												onCheckedChange={(checked) => {
													if (checked) {
														setBwlimitDownload({ enabled: true, value: 100, unit: "M" });
													} else {
														setBwlimitDownload({ enabled: false, value: 0, unit: "M" });
													}
												}}
											/>
											<Label htmlFor="bwlimit-download-enabled">Download Speed Limit</Label>
										</div>
										{bwlimitDownload.enabled && (
											<div className="flex items-center gap-2">
												<Input
													type="number"
													min={0}
													className="w-20"
													value={bwlimitDownload.value}
													onChange={(e) => {
														const val = Math.max(0, Number.parseInt(e.target.value, 10) || 0);
														setBwlimitDownload({ ...bwlimitDownload, value: val });
													}}
												/>
												<Select
													value={bwlimitDownload.unit}
													onValueChange={(val) => setBwlimitDownload({ ...bwlimitDownload, unit: val as keyof typeof BANDWIDTH_UNITS })}
												>
													<SelectTrigger className="w-24">
														<SelectValue />
													</SelectTrigger>
													<SelectContent>
														{Object.keys(BANDWIDTH_UNITS).map((unit) => (
															<SelectItem key={unit} value={unit}>
																{unit}iB/s
															</SelectItem>
														))}
													</SelectContent>
												</Select>
											</div>
										)}
										<p className="text-sm text-muted-foreground">
											{bwlimitDownload.enabled ? "Max download speed." : "Unlimited download speed."}
										</p>
									</div>
								</div>

								{/* Additional Arguments */}
								<div className="space-y-2">
									<Label htmlFor="additionalArgs">Additional Arguments</Label>
									<Input
										id="additionalArgs"
										placeholder="e.g. --drive-chunk-size 64M"
										value={additionalArgs}
										onChange={(e) => setAdditionalArgs(e.target.value)}
									/>
									<p className="text-sm text-muted-foreground">
										Additional command-line arguments to pass to rclone.
										{additionalArgs.trim() !== "" && (
											<span className="text-destructive"> Use with caution. Invalid arguments may cause backup failures or unexpected behavior.</span>
										)}
									</p>
								</div>
							</div>
						</div>
					)}

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
