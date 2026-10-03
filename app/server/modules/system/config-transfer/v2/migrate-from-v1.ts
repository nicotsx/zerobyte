import type { ConfigTransferModelV1 } from "../v1/model";
import type { ConfigTransferModelV2 } from "./model";

const notificationTemplates: ConfigTransferModelV2["notificationDestinations"][number]["templates"] = {
	backup_start: {
		title: "▶️ Backup started · Zerobyte",
		body: "{{#schedule}}\n**Schedule:** {{schedule}}\n{{/schedule}}\n**Source:** {{source}}\n**Repository:** {{repository}}",
	},
	backup_success: {
		title: "✅ Backup completed · Zerobyte",
		body: "{{#schedule}}\n**Schedule:** {{schedule}}\n{{/schedule}}\n**Source:** {{source}}\n**Repository:** {{repository}}\n{{#duration}}\n**Duration:** {{duration}}\n{{/duration}}\n{{#files}}\n**Files:** {{files}}\n{{/files}}\n{{#dataAdded}}\n**Data added:** {{dataAdded}}\n{{/dataAdded}}\n{{#dataStored}}\n**Data stored:** {{dataStored}}\n{{/dataStored}}\n{{#processedSize}}\n**Size:** {{processedSize}}\n{{/processedSize}}\n",
	},
	backup_warning: {
		title: "⚠️ Backup completed with warnings · Zerobyte",
		body: "{{#schedule}}\n**Schedule:** {{schedule}}\n{{/schedule}}\n**Source:** {{source}}\n**Repository:** {{repository}}\n{{#duration}}\n**Duration:** {{duration}}\n{{/duration}}\n{{#files}}\n**Files:** {{files}}\n{{/files}}\n{{#dataAdded}}\n**Data added:** {{dataAdded}}\n{{/dataAdded}}\n{{#dataStored}}\n**Data stored:** {{dataStored}}\n{{/dataStored}}\n{{#processedSize}}\n**Size:** {{processedSize}}\n{{/processedSize}}\n{{#error}}\n\n**Warning:**\n```\n{{error}}\n```\n{{/error}}",
	},
	backup_failure: {
		title: "❌ Backup failed · Zerobyte",
		body: "{{#schedule}}\n**Schedule:** {{schedule}}\n{{/schedule}}\n**Source:** {{source}}\n**Repository:** {{repository}}\n{{#duration}}\n**Duration:** {{duration}}\n{{/duration}}\n{{#files}}\n**Files:** {{files}}\n{{/files}}\n{{#dataAdded}}\n**Data added:** {{dataAdded}}\n{{/dataAdded}}\n{{#dataStored}}\n**Data stored:** {{dataStored}}\n{{/dataStored}}\n{{#processedSize}}\n**Size:** {{processedSize}}\n{{/processedSize}}\n{{#error}}\n\n**Error:**\n```\n{{error}}\n```\n{{/error}}",
	},
	mirror_failure: {
		title: "❌ Mirror sync failed · Zerobyte",
		body: "**Schedule:** {{schedule}}\n**Source repository:** {{sourceRepository}}\n**Mirror repository:** {{mirrorRepository}}\n{{#error}}\n\n**Error:**\n```\n{{error}}\n```\n{{/error}}",
	},
	test: {
		title: "🔔 Test notification · Zerobyte",
		body: "**Destination:** {{destination}}\n**Result:** Notifications are working.",
	},
};

export const migrateConfigTransferModelV1ToV2 = (model: ConfigTransferModelV1): ConfigTransferModelV2 => ({
	...model,
	notificationDestinations: model.notificationDestinations.map((destination) => ({
		...destination,
		templates: structuredClone(notificationTemplates),
	})),
});
