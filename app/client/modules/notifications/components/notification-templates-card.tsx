import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useId, useState } from "react";
import { toast } from "sonner";
import {
	getNotificationDestinationOptions,
	testNotificationTemplateMutation,
	updateNotificationDestinationMutation,
} from "~/client/api-client/@tanstack/react-query.gen";
import { Button } from "~/client/components/ui/button";
import { Card, CardTitle } from "~/client/components/ui/card";
import { Label } from "~/client/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "~/client/components/ui/select";
import { Textarea } from "~/client/components/ui/textarea";
import { parseError } from "~/client/lib/errors";
import {
	defaultNotificationTemplates,
	notificationTemplateKeys,
	type NotificationTemplateKey,
	type NotificationTemplateSet,
} from "~/lib/notification-templates/catalog";
import { evaluateNotificationTemplate, validateNotificationTemplate } from "~/lib/notification-templates/evaluate";
import { notificationTemplateSamples } from "~/lib/notification-templates/samples";
import { NotificationTemplatePreview } from "./notification-template-preview";

const eventLabels: Record<NotificationTemplateKey, string> = {
	backup_start: "Backup started",
	backup_success: "Backup completed",
	backup_warning: "Backup completed with warnings",
	backup_failure: "Backup failed",
	mirror_failure: "Mirror sync failed",
	test: "Test notification",
};

type Props = {
	notificationId: string;
	enabled: boolean;
	templates: NotificationTemplateSet;
};

export function NotificationTemplatesCard({ notificationId, enabled, templates }: Props) {
	const id = useId();
	const queryClient = useQueryClient();

	const [selected, setSelected] = useState<NotificationTemplateKey>("backup_success");
	const [draft, setDraft] = useState<NotificationTemplateSet | null>(null);

	const save = useMutation({
		...updateNotificationDestinationMutation(),
		onSuccess: async (destination) => {
			const queryKey = getNotificationDestinationOptions({ path: { id: notificationId } }).queryKey;

			await queryClient.cancelQueries({ queryKey });
			queryClient.setQueryData(queryKey, destination);

			setDraft(null);
			toast.success("Message templates saved");
		},
		onError: (error) =>
			toast.error("Failed to save message templates", { description: parseError(error)?.message }),
	});

	const sendTest = useMutation({
		...testNotificationTemplateMutation(),
		onSuccess: () => toast.success("Template test sent using example values"),
		onError: (error) => toast.error("Failed to send template test", { description: parseError(error)?.message }),
	});

	const current = draft ?? templates;
	const template = current[selected];
	const issues = validateNotificationTemplate(selected, template);
	const invalidEvents = notificationTemplateKeys.filter(
		(key) => validateNotificationTemplate(key, current[key]).length,
	);
	const context = notificationTemplateSamples[selected];
	const document = issues.length ? null : evaluateNotificationTemplate(selected, template, context);
	const busy = save.isPending || sendTest.isPending;

	const updateField = (field: "title" | "body", value: string) => {
		setDraft((previous) => {
			const values = previous ?? templates;

			return { ...values, [selected]: { ...values[selected], [field]: value } };
		});
	};

	return (
		<Card className="px-6 py-6">
			<CardTitle>Message templates</CardTitle>
			<p className="text-sm text-muted-foreground">
				Customize the messages sent to this destination for each event.
			</p>
			<div className="flex flex-wrap items-end justify-between gap-3">
				<div className="min-w-0 w-full space-y-2 sm:w-auto">
					<Label htmlFor={`${id}-event`}>Event</Label>
					<Select
						value={selected}
						onValueChange={(value) => setSelected(value as NotificationTemplateKey)}
						disabled={busy}
					>
						<SelectTrigger id={`${id}-event`} className="w-full sm:w-auto">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							{notificationTemplateKeys.map((key) => (
								<SelectItem key={key} value={key}>
									{eventLabels[key]}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</div>
				{!draft && (
					<Button variant="outline" onClick={() => setDraft(structuredClone(templates))}>
						Edit templates
					</Button>
				)}
			</div>
			<div className={draft ? "grid min-w-0 gap-6 @wide:grid-cols-2 items-start" : ""}>
				{draft && (
					<div className="min-w-0 space-y-4">
						{(["title", "body"] as const).map((field) => {
							const fieldIssues = issues.filter((issue) => issue.field === field);

							return (
								<div key={field} className="space-y-2">
									<Label htmlFor={`${id}-${field}`}>{field === "title" ? "Title" : "Body"}</Label>
									<Textarea
										id={`${id}-${field}`}
										value={template[field]}
										onChange={(event) => updateField(field, event.target.value)}
										disabled={busy}
										aria-invalid={fieldIssues.length > 0}
										aria-describedby={fieldIssues.length ? `${id}-${field}-errors` : undefined}
										className="font-mono text-sm resize-y"
										rows={field === "body" ? 14 : 2}
									/>
									{fieldIssues.length > 0 && (
										<div
											id={`${id}-${field}-errors`}
											role="alert"
											className="text-sm text-destructive"
										>
											{fieldIssues.map((issue) => (
												<p key={issue.message}>{issue.message}</p>
											))}
										</div>
									)}
								</div>
							);
						})}
						<a
							href="https://zerobyte.app/docs/guides/notifications#message-templates"
							target="_blank"
							rel="noopener noreferrer"
							className="text-sm underline underline-offset-4"
						>
							Template syntax and available variables
						</a>
					</div>
				)}
				<NotificationTemplatePreview document={document} />
			</div>
			{draft && (
				<div className="space-y-3">
					{invalidEvents.some((key) => key !== selected) && (
						<p role="alert" className="text-sm text-destructive">
							Fix errors before saving: {invalidEvents.map((key) => eventLabels[key]).join(", ")}.
						</p>
					)}
					<p className="text-xs text-muted-foreground">
						Save applies changes to all events. Reset restores this event's default title and body; save to
						apply it.
					</p>
					<div className="flex flex-wrap gap-2">
						<Button
							disabled={busy || invalidEvents.length > 0}
							loading={save.isPending}
							onClick={() => save.mutate({ path: { id: notificationId }, body: { templates: draft } })}
						>
							Save templates
						</Button>
						<Button variant="outline" disabled={busy} onClick={() => setDraft(null)}>
							Cancel
						</Button>
						<Button
							variant="outline"
							disabled={busy}
							onClick={() =>
								setDraft({ ...draft, [selected]: { ...defaultNotificationTemplates[selected] } })
							}
						>
							Reset to default
						</Button>
						<Button
							variant="outline"
							disabled={busy || issues.length > 0 || !enabled}
							loading={sendTest.isPending}
							onClick={() =>
								sendTest.mutate({ path: { id: notificationId }, body: { key: selected, template } })
							}
						>
							Send test
						</Button>
					</div>
					{!enabled && (
						<p className="text-xs text-muted-foreground">Enable this destination to send a test.</p>
					)}
				</div>
			)}
		</Card>
	);
}
