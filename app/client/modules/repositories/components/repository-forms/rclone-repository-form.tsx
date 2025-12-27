import type { UseFormReturn } from "react-hook-form";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ExternalLink } from "lucide-react";
import { useState } from "react";
import {
	FormControl,
	FormDescription,
	FormField,
	FormItem,
	FormLabel,
	FormMessage,
} from "../../../../components/ui/form";
import { Input } from "../../../../components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../../../components/ui/select";
import { Alert, AlertDescription } from "../../../../components/ui/alert";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "../../../../components/ui/collapsible";
import { Checkbox } from "../../../../components/ui/checkbox";
import { listRcloneRemotesOptions } from "../../../../api-client/@tanstack/react-query.gen";
import type { RepositoryFormValues } from "../create-repository-form";
import { cn } from "../../../../lib/utils";
import { BANDWIDTH_UNITS } from "~/schemas/restic";

type Props = {
	form: UseFormReturn<RepositoryFormValues>;
};

export const RcloneRepositoryForm = ({ form }: Props) => {
	const [advancedOpen, setAdvancedOpen] = useState(false);
	const { data: rcloneRemotes, isLoading: isLoadingRemotes } = useQuery(listRcloneRemotesOptions());

	const watchedBwlimitUpload = form.watch("bwlimitUpload");
	const watchedBwlimitDownload = form.watch("bwlimitDownload");

	if (!isLoadingRemotes && (!rcloneRemotes || rcloneRemotes.length === 0)) {
		return (
			<Alert>
				<AlertDescription className="space-y-2">
					<p className="font-medium">No rclone remotes configured</p>
					<p className="text-sm text-muted-foreground">
						To use rclone, you need to configure remotes on your host system
					</p>
					<a
						href="https://rclone.org/docs/"
						target="_blank"
						rel="noopener noreferrer"
						className="text-sm text-strong-accent inline-flex items-center gap-1"
					>
						View rclone documentation
						<ExternalLink className="w-3 h-3" />
					</a>
				</AlertDescription>
			</Alert>
		);
	}

	return (
		<>
			<FormField
				control={form.control}
				name="remote"
				render={({ field }) => (
					<FormItem>
						<FormLabel>Remote</FormLabel>
						<Select onValueChange={(v) => field.onChange(v)} defaultValue={field.value} value={field.value}>
							<FormControl>
								<SelectTrigger>
									<SelectValue placeholder="Select an rclone remote" />
								</SelectTrigger>
							</FormControl>
							<SelectContent>
								{isLoadingRemotes ? (
									<SelectItem value="loading" disabled>
										Loading remotes...
									</SelectItem>
								) : (
									rcloneRemotes?.map((remote: { name: string; type: string }) => (
										<SelectItem key={remote.name} value={remote.name}>
											{remote.name} ({remote.type})
										</SelectItem>
									))
								)}
							</SelectContent>
						</Select>
						<FormDescription>Select the rclone remote configured on your host system.</FormDescription>
						<FormMessage />
					</FormItem>
				)}
			/>
			<FormField
				control={form.control}
				name="path"
				render={({ field }) => (
					<FormItem>
						<FormLabel>Path</FormLabel>
						<FormControl>
							<Input placeholder="backups/zerobyte" {...field} />
						</FormControl>
						<FormDescription>Path within the remote where backups will be stored.</FormDescription>
						<FormMessage />
					</FormItem>
				)}
			/>

			{/* Advanced Options */}
			<Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen} className="space-y-2">
				<CollapsibleTrigger className="flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors">
					<ChevronDown
						className={cn("h-4 w-4 transition-transform duration-200", advancedOpen && "rotate-180")}
					/>
					Advanced Options
				</CollapsibleTrigger>
				<CollapsibleContent className="space-y-4 pt-2">
					{/* Fast List */}
					<FormField
						control={form.control}
						name="fastList"
						render={({ field }) => (
							<FormItem className="flex flex-row items-center space-x-3">
								<FormControl>
									<Checkbox
										checked={field.value ?? false}
										onCheckedChange={field.onChange}
									/>
								</FormControl>
								<div className="space-y-1">
									<FormLabel>Use Fast List</FormLabel>
									<FormDescription>
										Use more memory but fewer API transactions. Reduces costs and sync time on cloud providers.
									</FormDescription>
								</div>
							</FormItem>
						)}
					/>

					{/* Transfers and Checkers */}
					<div className="grid grid-cols-2 gap-4">
						<FormField
							control={form.control}
							name="transfers"
							render={({ field }) => (
								<FormItem>
									<FormLabel>Parallel Transfers</FormLabel>
									<FormControl>
										<Input
											type="number"
											min={1}
											max={128}
											placeholder="4"
											className="w-24"
											value={field.value ?? ""}
											onChange={(e) => {
												const val = e.target.value;
												if (val === "") {
													field.onChange(undefined);
												} else {
													const num = Number.parseInt(val, 10);
													if (!Number.isNaN(num)) {
														field.onChange(Math.min(128, Math.max(1, num)));
													}
												}
											}}
										/>
									</FormControl>
									<FormDescription>
										File transfers in parallel (1-128). Default: 4.
									</FormDescription>
									<FormMessage />
								</FormItem>
							)}
						/>
						<FormField
							control={form.control}
							name="checkers"
							render={({ field }) => (
								<FormItem>
									<FormLabel>Parallel Checkers</FormLabel>
									<FormControl>
										<Input
											type="number"
											min={1}
											max={256}
											placeholder="8"
											className="w-24"
											value={field.value ?? ""}
											onChange={(e) => {
												const val = e.target.value;
												if (val === "") {
													field.onChange(undefined);
												} else {
													const num = Number.parseInt(val, 10);
													if (!Number.isNaN(num)) {
														field.onChange(Math.min(256, Math.max(1, num)));
													}
												}
											}}
										/>
									</FormControl>
									<FormDescription>
										File checkers in parallel (1-256). Default: 8.
									</FormDescription>
									<FormMessage />
								</FormItem>
							)}
						/>
					</div>

					{/* Bandwidth Limits */}
					<div className="grid grid-cols-2 gap-4">
						<FormField
							control={form.control}
							name="bwlimitUpload"
							render={() => (
								<FormItem>
									<div className="flex flex-row items-center space-x-3 mb-2">
										<FormControl>
											<Checkbox
												id="bwlimit-upload-enabled"
												checked={watchedBwlimitUpload?.enabled ?? false}
												onCheckedChange={(checked) => {
													if (checked) {
														form.setValue("bwlimitUpload", {
															enabled: true,
															value: 10,
															unit: "M",
														});
													} else {
														form.setValue("bwlimitUpload", {
															enabled: false,
															value: 0,
															unit: "M",
														});
													}
												}}
											/>
										</FormControl>
										<FormLabel htmlFor="bwlimit-upload-enabled">Upload Speed Limit</FormLabel>
									</div>
									{watchedBwlimitUpload?.enabled && (
										<div className="flex items-center gap-2">
											<Input
												type="number"
												min={0}
												className="w-20"
												value={watchedBwlimitUpload.value}
												onChange={(e) => {
													const val = Math.max(0, Number.parseInt(e.target.value, 10) || 0);
													form.setValue("bwlimitUpload", {
														...watchedBwlimitUpload,
														value: val,
													});
												}}
											/>
											<Select
												value={watchedBwlimitUpload.unit}
												onValueChange={(val) => {
													form.setValue("bwlimitUpload", {
														...watchedBwlimitUpload,
														unit: val as keyof typeof BANDWIDTH_UNITS,
													});
												}}
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
									<FormDescription>
										{watchedBwlimitUpload?.enabled ? "Max upload speed." : "Unlimited upload speed."}
									</FormDescription>
								</FormItem>
							)}
						/>
						<FormField
							control={form.control}
							name="bwlimitDownload"
							render={() => (
								<FormItem>
									<div className="flex flex-row items-center space-x-3 mb-2">
										<FormControl>
											<Checkbox
												id="bwlimit-download-enabled"
												checked={watchedBwlimitDownload?.enabled ?? false}
												onCheckedChange={(checked) => {
													if (checked) {
														form.setValue("bwlimitDownload", {
															enabled: true,
															value: 100,
															unit: "M",
														});
													} else {
														form.setValue("bwlimitDownload", {
															enabled: false,
															value: 0,
															unit: "M",
														});
													}
												}}
											/>
										</FormControl>
										<FormLabel htmlFor="bwlimit-download-enabled">Download Speed Limit</FormLabel>
									</div>
									{watchedBwlimitDownload?.enabled && (
										<div className="flex items-center gap-2">
											<Input
												type="number"
												min={0}
												className="w-20"
												value={watchedBwlimitDownload.value}
												onChange={(e) => {
													const val = Math.max(0, Number.parseInt(e.target.value, 10) || 0);
													form.setValue("bwlimitDownload", {
														...watchedBwlimitDownload,
														value: val,
													});
												}}
											/>
											<Select
												value={watchedBwlimitDownload.unit}
												onValueChange={(val) => {
													form.setValue("bwlimitDownload", {
														...watchedBwlimitDownload,
														unit: val as keyof typeof BANDWIDTH_UNITS,
													});
												}}
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
									<FormDescription>
										{watchedBwlimitDownload?.enabled ? "Max download speed." : "Unlimited download speed."}
									</FormDescription>
								</FormItem>
							)}
						/>
					</div>

					{/* Additional Arguments */}
					<FormField
						control={form.control}
						name="additionalArgs"
						render={({ field }) => (
							<FormItem>
								<FormLabel>Additional Arguments</FormLabel>
								<FormControl>
									<Input
										placeholder="e.g. --drive-chunk-size 64M"
										{...field}
										value={field.value ?? ""}
									/>
								</FormControl>
								<FormDescription>
									Additional command-line arguments to pass to rclone.
									{field.value && field.value.trim() !== "" && (
										<span className="text-destructive"> Use with caution. Invalid arguments may cause backup failures or unexpected behavior.</span>
									)}
								</FormDescription>
								<FormMessage />
							</FormItem>
						)}
					/>
				</CollapsibleContent>
			</Collapsible>
		</>
	);
};
