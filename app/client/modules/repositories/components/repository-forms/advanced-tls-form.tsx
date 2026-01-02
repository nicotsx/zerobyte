import type { UseFormReturn } from "react-hook-form";
import {
	FormControl,
	FormDescription,
	FormField,
	FormItem,
	FormLabel,
	FormMessage,
} from "../../../../components/ui/form";
import { Textarea } from "../../../../components/ui/textarea";
import { Checkbox } from "../../../../components/ui/checkbox";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../../../components/ui/tooltip";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "../../../../components/ui/collapsible";
import type { RepositoryFormValues } from "../create-repository-form";
import { cn } from "~/client/lib/utils";

type Props = {
	form: UseFormReturn<RepositoryFormValues>;
};

export const AdvancedForm = ({ form }: Props) => {
	const insecureTls = form.watch("insecureTls");
	const cacert = form.watch("cacert");

	return (
		<Collapsible>
			<CollapsibleTrigger className="w-full text-muted-foreground hover:no-underline">
				Advanced Settings
			</CollapsibleTrigger>
			<CollapsibleContent className="pb-4 space-y-4">
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
