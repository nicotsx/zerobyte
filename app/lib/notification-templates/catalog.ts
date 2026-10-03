export const notificationTemplateKeys = [
	"backup_start",
	"backup_success",
	"backup_warning",
	"backup_failure",
	"mirror_failure",
	"test",
] as const;

export type NotificationTemplateKey = (typeof notificationTemplateKeys)[number];
export type NotificationTemplate = { title: string; body: string };
export type NotificationTemplateSet = Record<NotificationTemplateKey, NotificationTemplate>;
export type NotificationTemplateContext = Partial<Record<NotificationVariable, string>>;

export const notificationVariables = {
	schedule: "Backup schedule name",
	source: "Backup source name",
	repository: "Backup repository name",
	duration: "Formatted elapsed time",
	files: "Formatted files processed (including zero)",
	dataAdded: "Formatted data added",
	dataStored: "Formatted compressed data stored",
	processedSize: "Formatted processed size, when data added is unavailable",
	error: "Sanitized, readable error or warning",
	sourceRepository: "Mirror source repository name",
	mirrorRepository: "Mirror destination repository name",
	destination: "Notification destination name",
} as const;

export type NotificationVariable = keyof typeof notificationVariables;

const backupVariables: NotificationVariable[] = ["schedule", "source", "repository"];
const resultVariables: NotificationVariable[] = [
	...backupVariables,
	"duration",
	"files",
	"dataAdded",
	"dataStored",
	"processedSize",
];

export const templateVariables: Record<NotificationTemplateKey, readonly NotificationVariable[]> = {
	backup_start: backupVariables,
	backup_success: resultVariables,
	backup_warning: [...resultVariables, "error"],
	backup_failure: [...resultVariables, "error"],
	mirror_failure: ["schedule", "sourceRepository", "mirrorRepository", "error"],
	test: ["destination"],
};

const backupBody = `{{#schedule}}
**Schedule:** {{schedule}}
{{/schedule}}
**Source:** {{source}}
**Repository:** {{repository}}`;

const statistics = `{{#duration}}
**Duration:** {{duration}}
{{/duration}}
{{#files}}
**Files:** {{files}}
{{/files}}
{{#dataAdded}}
**Data added:** {{dataAdded}}
{{/dataAdded}}
{{#dataStored}}
**Data stored:** {{dataStored}}
{{/dataStored}}
{{#processedSize}}
**Size:** {{processedSize}}
{{/processedSize}}
`;

const errorBody = (label: string) => `{{#error}}

**${label}:**
\`\`\`
{{error}}
\`\`\`
{{/error}}`;

const resultBody = `${backupBody}\n${statistics}`;

export const defaultNotificationTemplates: NotificationTemplateSet = {
	backup_start: { title: "▶️ Backup started · Zerobyte", body: backupBody },
	backup_success: { title: "✅ Backup completed · Zerobyte", body: resultBody },
	backup_warning: {
		title: "⚠️ Backup completed with warnings · Zerobyte",
		body: resultBody + errorBody("Warning"),
	},
	backup_failure: { title: "❌ Backup failed · Zerobyte", body: resultBody + errorBody("Error") },
	mirror_failure: {
		title: "❌ Mirror sync failed · Zerobyte",
		body:
			"**Schedule:** {{schedule}}\n**Source repository:** {{sourceRepository}}\n**Mirror repository:** {{mirrorRepository}}\n" +
			errorBody("Error"),
	},
	test: {
		title: "🔔 Test notification · Zerobyte",
		body: "**Destination:** {{destination}}\n**Result:** Notifications are working.",
	},
};
