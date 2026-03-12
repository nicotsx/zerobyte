import { z } from "zod";
import { describeRoute, resolver } from "hono-openapi";
import {
	COMPRESSION_MODES,
	OVERWRITE_MODES,
	REPOSITORY_BACKENDS,
	REPOSITORY_STATUS,
	repositoryConfigSchema,
	doctorResultSchema,
	resticSnapshotSummarySchema,
	resticStatsSchema,
} from "@zerobyte/core/restic";

export const repositorySchema = z.object({
	id: z.string(),
	shortId: z.string(),
	provisioningId: z.string().nullable(),
	name: z.string(),
	type: z.enum(REPOSITORY_BACKENDS),
	config: repositoryConfigSchema,
	compressionMode: z.enum(COMPRESSION_MODES).nullable(),
	status: z.enum(REPOSITORY_STATUS).nullable(),
	lastChecked: z.number().nullable(),
	lastError: z.string().nullable(),
	doctorResult: doctorResultSchema.nullable(),
	createdAt: z.number(),
	updatedAt: z.number(),
});

export type RepositoryDto = z.infer<typeof repositorySchema>;

export const listRepositoriesResponse = repositorySchema.array();
export type ListRepositoriesDto = z.infer<typeof listRepositoriesResponse>;

export const listRepositoriesDto = describeRoute({
	description: "List all repositories",
	tags: ["Repositories"],
	operationId: "listRepositories",
	responses: {
		200: {
			description: "List of repositories",
			content: {
				"application/json": {
					schema: resolver(listRepositoriesResponse),
				},
			},
		},
	},
});

export const createRepositoryBody = z.object({
	name: z.string(),
	compressionMode: z.enum(COMPRESSION_MODES).optional(),
	config: repositoryConfigSchema,
});

export type CreateRepositoryBody = z.infer<typeof createRepositoryBody>;

export const createRepositoryResponse = z.object({
	message: z.string(),
	repository: z.object({
		id: z.string(),
		shortId: z.string(),
		name: z.string(),
	}),
});

export type CreateRepositoryDto = z.infer<typeof createRepositoryResponse>;

export const createRepositoryDto = describeRoute({
	description: "Create a new restic repository",
	operationId: "createRepository",
	tags: ["Repositories"],
	responses: {
		201: {
			description: "Repository created successfully",
			content: {
				"application/json": {
					schema: resolver(createRepositoryResponse),
				},
			},
		},
	},
});

export const getRepositoryResponse = repositorySchema;
export type GetRepositoryDto = z.infer<typeof getRepositoryResponse>;

export const getRepositoryDto = describeRoute({
	description: "Get a single repository by ID",
	tags: ["Repositories"],
	operationId: "getRepository",
	responses: {
		200: {
			description: "Repository details",
			content: {
				"application/json": {
					schema: resolver(getRepositoryResponse),
				},
			},
		},
	},
});

export const repositoryStatsSchema = resticStatsSchema;
export const getRepositoryStatsResponse = repositoryStatsSchema;
export type GetRepositoryStatsDto = z.infer<typeof getRepositoryStatsResponse>;

export const getRepositoryStatsDto = describeRoute({
	description: "Get repository storage and compression statistics",
	tags: ["Repositories"],
	operationId: "getRepositoryStats",
	responses: {
		200: {
			description: "Repository statistics",
			content: {
				"application/json": {
					schema: resolver(getRepositoryStatsResponse),
				},
			},
		},
	},
});

export const refreshRepositoryStatsResponse = repositoryStatsSchema;
export type RefreshRepositoryStatsDto = z.infer<typeof refreshRepositoryStatsResponse>;

export const refreshRepositoryStatsDto = describeRoute({
	description: "Refresh repository storage and compression statistics",
	tags: ["Repositories"],
	operationId: "refreshRepositoryStats",
	responses: {
		200: {
			description: "Refreshed repository statistics",
			content: {
				"application/json": {
					schema: resolver(refreshRepositoryStatsResponse),
				},
			},
		},
	},
});

export const deleteRepositoryResponse = z.object({
	message: z.string(),
});

export type DeleteRepositoryDto = z.infer<typeof deleteRepositoryResponse>;

export const deleteRepositoryDto = describeRoute({
	description: "Delete a repository",
	tags: ["Repositories"],
	operationId: "deleteRepository",
	responses: {
		200: {
			description: "Repository deleted successfully",
			content: {
				"application/json": {
					schema: resolver(deleteRepositoryResponse),
				},
			},
		},
	},
});

export const updateRepositoryBody = z.object({
	name: z.string().optional(),
	compressionMode: z.enum(COMPRESSION_MODES).optional(),
	config: repositoryConfigSchema.optional(),
});

export type UpdateRepositoryBody = z.infer<typeof updateRepositoryBody>;

export const updateRepositoryResponse = repositorySchema;
export type UpdateRepositoryDto = z.infer<typeof updateRepositoryResponse>;

export const updateRepositoryDto = describeRoute({
	description: "Update a repository's name or settings",
	tags: ["Repositories"],
	operationId: "updateRepository",
	responses: {
		200: {
			description: "Repository updated successfully",
			content: {
				"application/json": {
					schema: resolver(updateRepositoryResponse),
				},
			},
		},
		400: {
			description: "Invalid repository update payload",
		},
		404: {
			description: "Repository not found",
		},
		409: {
			description: "Repository with this name already exists",
		},
	},
});

export const snapshotSchema = z.object({
	short_id: z.string(),
	time: z.number(),
	paths: z.array(z.string()),
	size: z.number(),
	duration: z.number(),
	tags: z.array(z.string()),
	retentionCategories: z.array(z.string()),
	hostname: z.string().optional(),
	summary: resticSnapshotSummarySchema.optional(),
});

const listSnapshotsResponse = snapshotSchema.array();

export type ListSnapshotsDto = z.infer<typeof listSnapshotsResponse>;

export const listSnapshotsFilters = z.object({
	backupId: z.string().optional(),
});

export const listSnapshotsDto = describeRoute({
	description: "List all snapshots in a repository",
	tags: ["Repositories"],
	operationId: "listSnapshots",
	responses: {
		200: {
			description: "List of snapshots",
			content: {
				"application/json": {
					schema: resolver(listSnapshotsResponse),
				},
			},
		},
	},
});

export const getSnapshotDetailsResponse = snapshotSchema;

export type GetSnapshotDetailsDto = z.infer<typeof getSnapshotDetailsResponse>;

export const getSnapshotDetailsDto = describeRoute({
	description: "Get details of a specific snapshot",
	tags: ["Repositories"],
	operationId: "getSnapshotDetails",
	responses: {
		200: {
			description: "Snapshot details",
			content: {
				"application/json": {
					schema: resolver(getSnapshotDetailsResponse),
				},
			},
		},
	},
});

export const snapshotFileNodeSchema = z.object({
	name: z.string(),
	type: z.string(),
	path: z.string(),
	uid: z.number().optional(),
	gid: z.number().optional(),
	size: z.number().optional(),
	mode: z.number().optional(),
	mtime: z.string().optional(),
	atime: z.string().optional(),
	ctime: z.string().optional(),
});

export const listSnapshotFilesResponse = z.object({
	snapshot: z.object({
		id: z.string(),
		short_id: z.string(),
		time: z.string(),
		hostname: z.string().optional(),
		paths: z.array(z.string()),
	}),
	files: snapshotFileNodeSchema.array(),
	offset: z.number(),
	limit: z.number(),
	total: z.number(),
	hasMore: z.boolean(),
});

export type ListSnapshotFilesDto = z.infer<typeof listSnapshotFilesResponse>;

export const listSnapshotFilesQuery = z.object({
	path: z.string().optional(),
	offset: z.coerce.number().int().optional(),
	limit: z.coerce.number().int().optional(),
});

export const listSnapshotFilesDto = describeRoute({
	description: "List files and directories in a snapshot",
	tags: ["Repositories"],
	operationId: "listSnapshotFiles",
	responses: {
		200: {
			description: "List of files and directories in the snapshot",
			content: {
				"application/json": {
					schema: resolver(listSnapshotFilesResponse),
				},
			},
		},
	},
});

const DUMP_PATH_KINDS = {
	file: "file",
	dir: "dir",
} as const;

export const dumpPathKindSchema = z.enum(DUMP_PATH_KINDS);
export type DumpPathKind = z.infer<typeof dumpPathKindSchema>;

export const dumpSnapshotQuery = z.object({
	path: z.string().optional(),
	kind: dumpPathKindSchema.optional(),
});

export const dumpSnapshotDto = describeRoute({
	description: "Download a snapshot path as a tar archive (folders) or raw file stream (single files)",
	tags: ["Repositories"],
	operationId: "dumpSnapshot",
	responses: {
		200: {
			description: "Snapshot content stream",
			content: {
				"application/x-tar": {
					schema: { type: "string", format: "binary" },
				},
				"application/octet-stream": {
					schema: { type: "string", format: "binary" },
				},
			},
		},
	},
});

export const overwriteModeSchema = z.enum(OVERWRITE_MODES);

export const restoreSnapshotBody = z.object({
	snapshotId: z.string(),
	include: z.array(z.string()).optional(),
	selectedItemKind: dumpPathKindSchema.optional(),
	exclude: z.array(z.string()).optional(),
	excludeXattr: z.array(z.string()).optional(),
	delete: z.boolean().optional(),
	targetPath: z.string().optional(),
	overwrite: overwriteModeSchema.optional(),
});

export type RestoreSnapshotBody = z.infer<typeof restoreSnapshotBody>;

export const restoreSnapshotResponse = z.object({
	success: z.boolean(),
	message: z.string(),
	filesRestored: z.number(),
	filesSkipped: z.number(),
});

export type RestoreSnapshotDto = z.infer<typeof restoreSnapshotResponse>;

export const restoreSnapshotDto = describeRoute({
	description: "Restore a snapshot to a target path on the filesystem",
	tags: ["Repositories"],
	operationId: "restoreSnapshot",
	responses: {
		200: {
			description: "Snapshot restored successfully",
			content: {
				"application/json": {
					schema: resolver(restoreSnapshotResponse),
				},
			},
		},
	},
});

export const startDoctorResponse = z.object({
	message: z.string(),
	repositoryId: z.string(),
});

export type StartDoctorDto = z.infer<typeof startDoctorResponse>;

export const startDoctorDto = describeRoute({
	description:
		"Start an asynchronous doctor operation on a repository to fix common issues (unlock, check, repair index). The operation runs in the background and sends results via SSE events.",
	tags: ["Repositories"],
	operationId: "startDoctor",
	responses: {
		202: {
			description: "Doctor operation started",
			content: {
				"application/json": {
					schema: resolver(startDoctorResponse),
				},
			},
		},
		409: {
			description: "Doctor operation already in progress",
		},
	},
});

export const cancelDoctorResponse = z.object({
	message: z.string(),
});

export type CancelDoctorDto = z.infer<typeof cancelDoctorResponse>;

export const cancelDoctorDto = describeRoute({
	description: "Cancel a running doctor operation on a repository",
	tags: ["Repositories"],
	operationId: "cancelDoctor",
	responses: {
		200: {
			description: "Doctor operation cancelled",
			content: {
				"application/json": {
					schema: resolver(cancelDoctorResponse),
				},
			},
		},
		409: {
			description: "No doctor operation is currently running",
		},
	},
});

const rcloneRemoteSchema = z.object({
	name: z.string(),
	type: z.string(),
});

const listRcloneRemotesResponse = rcloneRemoteSchema.array();

export const listRcloneRemotesDto = describeRoute({
	description: "List all configured rclone remotes on the host system",
	tags: ["Rclone"],
	operationId: "listRcloneRemotes",
	responses: {
		200: {
			description: "List of rclone remotes",
			content: {
				"application/json": {
					schema: resolver(listRcloneRemotesResponse),
				},
			},
		},
	},
});

export const deleteSnapshotResponse = z.object({
	message: z.string(),
});

export type DeleteSnapshotDto = z.infer<typeof deleteSnapshotResponse>;

export const deleteSnapshotDto = describeRoute({
	description: "Delete a specific snapshot from a repository",
	tags: ["Repositories"],
	operationId: "deleteSnapshot",
	responses: {
		200: {
			description: "Snapshot deleted successfully",
			content: {
				"application/json": {
					schema: resolver(deleteSnapshotResponse),
				},
			},
		},
	},
});

export const deleteSnapshotsBody = z.object({
	snapshotIds: z.array(z.string()).min(1),
});

export const deleteSnapshotsResponse = z.object({
	message: z.string(),
});

export type DeleteSnapshotsResponseDto = z.infer<typeof deleteSnapshotsResponse>;

export const deleteSnapshotsDto = describeRoute({
	description: "Delete multiple snapshots from a repository",
	tags: ["Repositories"],
	operationId: "deleteSnapshots",
	responses: {
		200: {
			description: "Snapshots deleted successfully",
			content: {
				"application/json": {
					schema: resolver(deleteSnapshotsResponse),
				},
			},
		},
	},
});

export const tagSnapshotsBody = z.object({
	snapshotIds: z.array(z.string()).min(1),
	add: z.array(z.string()).optional(),
	remove: z.array(z.string()).optional(),
	set: z.array(z.string()).optional(),
});

export const tagSnapshotsResponse = z.object({
	message: z.string(),
});

export type TagSnapshotsResponseDto = z.infer<typeof tagSnapshotsResponse>;

export const tagSnapshotsDto = describeRoute({
	description: "Tag multiple snapshots in a repository",
	tags: ["Repositories"],
	operationId: "tagSnapshots",
	responses: {
		200: {
			description: "Snapshots tagged successfully",
			content: {
				"application/json": {
					schema: resolver(tagSnapshotsResponse),
				},
			},
		},
	},
});

export const refreshSnapshotsResponse = z.object({
	message: z.string(),
	count: z.number(),
});

export type RefreshSnapshotsDto = z.infer<typeof refreshSnapshotsResponse>;

export const refreshSnapshotsDto = describeRoute({
	description: "Clear snapshot cache and force refresh from repository",
	tags: ["Repositories"],
	operationId: "refreshSnapshots",
	responses: {
		200: {
			description: "Snapshot cache cleared and refreshed",
			content: {
				"application/json": {
					schema: resolver(refreshSnapshotsResponse),
				},
			},
		},
	},
});

export const devPanelExecBody = z.object({
	command: z.string(),
	args: z.array(z.string()).optional(),
});

export type DevPanelExecBody = z.infer<typeof devPanelExecBody>;

export const devPanelExecDto = describeRoute({
	description: "Execute a restic command against a repository (dev panel only)",
	tags: ["Repositories"],
	operationId: "devPanelExec",
	responses: {
		200: {
			description: "Command output stream (SSE)",
			content: {
				"text/event-stream": {
					schema: { type: "string" },
				},
			},
		},
		403: {
			description: "Dev panel not enabled",
		},
	},
});

export const unlockRepositoryResponse = z.object({
	success: z.boolean(),
	message: z.string(),
});

export type UnlockRepositoryDto = z.infer<typeof unlockRepositoryResponse>;

export const unlockRepositoryDto = describeRoute({
	description: "Unlock a repository by removing all stale locks",
	tags: ["Repositories"],
	operationId: "unlockRepository",
	responses: {
		200: {
			description: "Repository unlocked successfully",
			content: {
				"application/json": {
					schema: resolver(unlockRepositoryResponse),
				},
			},
		},
	},
});
