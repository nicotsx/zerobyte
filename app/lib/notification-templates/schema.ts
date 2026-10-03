import { z } from "zod";
import { notificationTemplateKeys, type NotificationTemplateKey } from "./catalog";
import { validateNotificationTemplate } from "./evaluate";

export const notificationTemplateKeySchema = z.enum(notificationTemplateKeys);
export const notificationTemplateSchema = z.object({ title: z.string(), body: z.string() }).strict();

export const notificationTemplateSchemaForKey = (key: NotificationTemplateKey) =>
	notificationTemplateSchema.superRefine((template, ctx) => {
		for (const issue of validateNotificationTemplate(key, template)) {
			ctx.addIssue({ code: "custom", path: [issue.field], message: issue.message });
		}
	});

export const notificationTemplateSetSchema = z
	.object({
		backup_start: notificationTemplateSchemaForKey("backup_start"),
		backup_success: notificationTemplateSchemaForKey("backup_success"),
		backup_warning: notificationTemplateSchemaForKey("backup_warning"),
		backup_failure: notificationTemplateSchemaForKey("backup_failure"),
		mirror_failure: notificationTemplateSchemaForKey("mirror_failure"),
		test: notificationTemplateSchemaForKey("test"),
	})
	.strict();

export const notificationTemplateDraftSchema = z
	.object({
		key: notificationTemplateKeySchema,
		template: notificationTemplateSchema,
	})
	.strict()
	.superRefine(({ key, template }, ctx) => {
		for (const issue of validateNotificationTemplate(key, template)) {
			ctx.addIssue({ code: "custom", path: ["template", issue.field], message: issue.message });
		}
	});
