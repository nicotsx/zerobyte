import type { UseFormReturn } from "react-hook-form";
import {
	FormControl,
	FormDescription,
	FormField,
	FormItem,
	FormLabel,
	FormMessage,
} from "../../../../components/ui/form";
import { Input } from "../../../../components/ui/input";
import { Textarea } from "../../../../components/ui/textarea";
import { Checkbox } from "../../../../components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../../../components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../../../components/ui/tooltip";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "../../../../components/ui/collapsible";
import type { RepositoryFormValues } from "../create-repository-form";
import { cn } from "~/client/lib/utils";
import { BANDWIDTH_UNITS } from "~/schemas/restic";

type Props = {
	form: UseFormReturn<RepositoryFormValues>;
};

export const AdvancedForm = ({ form }: Props) => {
	const insecureTls = form.watch("insecureTls");
	const cacert = form.watch("cacert");
	const uploadLimitEnabled = form.watch("uploadLimit.enabled");
	const downloadLimitEnabled = form.watch("downloadLimit.enabled");

	return (
		<Collapsible>
			<CollapsibleTrigger>Advanced Settings</CollapsibleTrigger>
			<CollapsibleContent className="pb-4 space-y-4">
				<div className="space-y-4 mt-4">
					<div className="grid gap-6">
						<div className="space-y-4 rounded-lg border bg-background/50 p-4">
							<FormField
								control={form.control}
								name="uploadLimit.enabled"
								render={({ field }) => (
									<FormItem className="flex flex-row items-start space-x-3 space-y-0">
										<FormControl>
											<Checkbox checked={field.value ?? false} onCheckedChange={field.onChange} />
										</FormControl>
										<div className="space-y-1">
											<FormLabel>Enable upload speed limit</FormLabel>
											<FormDescription className="text-xs">Limit upload speed to the repository</FormDescription>
										</div>
									</FormItem>
								)}
							/>
							<div className="flex items-center gap-2">
								<FormField
									control={form.control}
									name="uploadLimit.value"
									render={({ field }) => (
										<FormItem className="flex-1">
											<FormControl>
												<div className="relative">
													<Input
														disabled={!uploadLimitEnabled}
														type="number"
														min={1}
														step={0.1}
														max={999999}
														placeholder="10"
														className="pr-12"
														{...field}
														onChange={(e) => field.onChange(parseFloat(e.target.value) || 1)}
													/>
													<div className="absolute inset-y-0 right-0 flex items-center pr-3">
														<div className="h-4 w-px bg-border" />
													</div>
													<FormMessage />
												</div>
											</FormControl>
										</FormItem>
									)}
								/>
								<FormField
									control={form.control}
									name="uploadLimit.unit"
									render={({ field }) => (
										<FormItem className="w-24">
											<Select
												onValueChange={field.onChange}
												defaultValue={field.value || "Mbps"}
												value={field.value || "Mbps"}
												disabled={!uploadLimitEnabled}
											>
												<FormControl>
													<SelectTrigger className="text-xs">
														<SelectValue />
													</SelectTrigger>
												</FormControl>
												<SelectContent>
													{Object.keys(BANDWIDTH_UNITS).map((unit) => (
														<SelectItem key={unit} value={unit} className="text-xs">
															{unit}
														</SelectItem>
													))}
												</SelectContent>
											</Select>
											<FormMessage />
										</FormItem>
									)}
								/>
							</div>
						</div>
					</div>

					<div className="rounded-lg border bg-background/50 p-4">
						<FormField
							control={form.control}
							name="downloadLimit.enabled"
							render={({ field }) => (
								<FormItem className="flex flex-row items-start space-x-3 space-y-0">
									<FormControl>
										<Checkbox checked={field.value ?? false} onCheckedChange={field.onChange} />
									</FormControl>
									<div className="space-y-1">
										<FormLabel>Enable download speed limit</FormLabel>
										<FormDescription className="text-xs">Limit download speed from the repository</FormDescription>
									</div>
								</FormItem>
							)}
						/>

						<div className="space-y-3 pt-2">
							<div className="flex items-center gap-2">
								<FormField
									control={form.control}
									name="downloadLimit.value"
									render={({ field }) => (
										<FormItem className="flex-1">
											<FormControl>
												<div className="relative">
													<Input
														placeholder="10"
														type="number"
														min={1}
														step={0.1}
														max={999999}
														disabled={!downloadLimitEnabled}
														className="pr-12"
														{...field}
														onChange={(e) => field.onChange(parseFloat(e.target.value) || 1)}
													/>
													<div className="absolute inset-y-0 right-0 flex items-center pr-3">
														<div className="h-4 w-px bg-border" />
													</div>
												</div>
											</FormControl>
											<FormMessage />
										</FormItem>
									)}
								/>
								<FormField
									control={form.control}
									name="downloadLimit.unit"
									render={({ field }) => (
										<FormItem className="w-24">
											<Select
												onValueChange={field.onChange}
												defaultValue={field.value || "Mbps"}
												value={field.value || "Mbps"}
											>
												<FormControl>
													<SelectTrigger className="text-xs">
														<SelectValue />
													</SelectTrigger>
												</FormControl>
												<SelectContent>
													{Object.keys(BANDWIDTH_UNITS).map((unit) => (
														<SelectItem key={unit} value={unit} className="text-xs">
															{unit}
														</SelectItem>
													))}
												</SelectContent>
											</Select>
											<FormMessage />
										</FormItem>
									)}
								/>
							</div>
						</div>
					</div>
				</div>

				<FormField
					control={form.control}
					name="insecureTls"
					render={({ field }) => (
						<FormItem className="flex flex-row items-start space-x-3 space-y-0 rounded-md border p-4">
							<FormControl>
								<Tooltip delayDuration={500}>
									<TooltipTrigger asChild>
										<div>
											<Checkbox
												checked={field.value ?? false}
												disabled={!!cacert}
												onCheckedChange={(checked) => {
													field.onChange(checked);
												}}
											/>
										</div>
									</TooltipTrigger>
									<TooltipContent className={cn({ hidden: !cacert })}>
										<p className="max-w-xs">
											This option is disabled because a CA certificate is provided. Remove the CA certificate to skip
											TLS validation instead.
										</p>
									</TooltipContent>
								</Tooltip>
							</FormControl>
							<div className="space-y-1 leading-none">
								<FormLabel>Skip TLS certificate verification</FormLabel>
								<FormDescription>
									Disable TLS certificate verification for HTTPS connections with self-signed certificates. This is
									insecure and should only be used for testing.
								</FormDescription>
							</div>
						</FormItem>
					)}
				/>
				<FormField
					control={form.control}
					name="cacert"
					render={({ field }) => (
						<FormItem>
							<FormLabel>CA Certificate (Optional)</FormLabel>
							<FormControl>
								<Tooltip delayDuration={500}>
									<TooltipTrigger asChild>
										<div>
											<Textarea
												placeholder={"-----BEGIN CERTIFICATE-----\n...\n-----END CERTIFICATE-----"}
												rows={6}
												disabled={insecureTls}
												{...field}
											/>
										</div>
									</TooltipTrigger>
									<TooltipContent className={cn({ hidden: !insecureTls })}>
										<p className="max-w-xs">
											CA certificate is disabled because TLS validation is being skipped. Uncheck "Skip TLS Certificate
											Verification" to provide a custom CA certificate.
										</p>
									</TooltipContent>
								</Tooltip>
							</FormControl>
							<FormDescription>
								Custom CA certificate for self-signed certificates (PEM format). This applies to HTTPS
								connections.&nbsp;
								<a
									href="https://restic.readthedocs.io/en/stable/030_preparing_a_new_repo.html#rest-server"
									target="_blank"
									rel="noopener noreferrer"
									className="text-primary hover:underline"
								>
									Learn more
								</a>
							</FormDescription>
							<FormMessage />
						</FormItem>
					)}
				/>
			</CollapsibleContent>
		</Collapsible>
	);
};
