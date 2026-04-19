import { z } from "zod";
import {
	COMPRESSION_MODES,
	OVERWRITE_MODES,
	repositoryConfigSchema,
	type RepositoryConfig,
} from "@zerobyte/core/restic";
import { volumeConfigSchema, type BackendConfig } from "@zerobyte/contracts/volumes";

const modeSchema = z
	.union([z.number(), z.string().transform((value) => Number.parseInt(value, 8))])
	.transform((value) => value & 0o7777);

const entryTypeSchema = z.enum(["file", "directory", "symlink"]);

const expectedEntrySchema = z
	.object({
		path: z.string().min(1),
		type: entryTypeSchema,
		uid: z.number().optional(),
		gid: z.number().optional(),
		mode: modeSchema.optional(),
		sha256: z.string().optional(),
		text: z.string().optional(),
		linkTarget: z.string().min(1).optional(),
	})
	.superRefine((value, ctx) => {
		if (value.sha256 && value.text) {
			ctx.addIssue({
				code: "custom",
				message: "Specify either sha256 or text, not both",
				path: ["sha256"],
			});
		}

		if (value.type !== "file" && (value.sha256 || value.text)) {
			ctx.addIssue({
				code: "custom",
				message: "Only file entries can define sha256 or text expectations",
				path: ["type"],
			});
		}

		if (value.type !== "symlink" && value.linkTarget) {
			ctx.addIssue({
				code: "custom",
				message: "Only symlink entries can define linkTarget",
				path: ["linkTarget"],
			});
		}
	});

const backupOptionsSchema = z.object({
	compressionMode: z.enum(COMPRESSION_MODES).optional(),
	tags: z.array(z.string().min(1)).optional(),
	customResticParams: z.array(z.string().min(1)).optional(),
});

const restoreOptionsSchema = z.object({
	excludeXattr: z.array(z.string().min(1)).optional(),
	overwrite: z.enum(OVERWRITE_MODES).optional(),
});

const scenarioSchema = z.object({
	id: z.string().min(1),
	description: z.string().optional(),
	volume: volumeConfigSchema,
	repository: repositoryConfigSchema,
	fixtureRoot: z.string().min(1).default("."),
	expectedEntries: z.array(expectedEntrySchema).min(1),
	backup: backupOptionsSchema.optional(),
	restore: restoreOptionsSchema.optional(),
});

export const configSchema = z.object({
	version: z.literal(1).default(1),
	scenarios: z.array(scenarioSchema).min(1),
});

export type ExpectedEntry = z.infer<typeof expectedEntrySchema>;
export type IntegrationScenario = z.infer<typeof scenarioSchema> & {
	volume: BackendConfig;
	repository: RepositoryConfig;
};
