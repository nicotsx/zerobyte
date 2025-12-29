import { type } from "arktype";
import { describeRoute, resolver } from "hono-openapi";
import {
	COMPRESSION_MODES,
	OVERWRITE_MODES,
	REPOSITORY_BACKENDS,
	REPOSITORY_STATUS,
	repositoryConfigSchema,
} from "~/schemas/restic";

export const repositorySchema = type({
	id: "string",
	shortId: "string",
	name: "string",
	type: type.valueOf(REPOSITORY_BACKENDS),
	config: repositoryConfigSchema,
	compressionMode: type.valueOf(COMPRESSION_MODES).or("null"),
	status: type.valueOf(REPOSITORY_STATUS).or("null"),
	lastChecked: "number | null",
	lastError: "string | null",
	createdAt: "number",
	updatedAt: "number",
});

export type RepositoryDto = typeof repositorySchema.infer;

/**
 * List all repositories
 */
export const listRepositoriesResponse = repositorySchema.array();
export type ListRepositoriesDto = typeof listRepositoriesResponse.infer;

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

/**
 * Create a new repository
 */
export const createRepositoryBody = type({
	name: "string",
	compressionMode: type.valueOf(COMPRESSION_MODES).optional(),
	config: repositoryConfigSchema,
});

export type CreateRepositoryBody = typeof createRepositoryBody.infer;

export const createRepositoryResponse = type({
	message: "string",
	repository: type({
		id: "string",
		shortId: "string",
		name: "string",
	}),
});

export type CreateRepositoryDto = typeof createRepositoryResponse.infer;

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

/**
 * Get a single repository
 */
export const getRepositoryResponse = repositorySchema;
export type GetRepositoryDto = typeof getRepositoryResponse.infer;

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

/**
 * Delete a repository
 */
export const deleteRepositoryResponse = type({
	message: "string",
});

export type DeleteRepositoryDto = typeof deleteRepositoryResponse.infer;

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

/**
 * Update a repository
 */
export const updateRepositoryBody = type({
	name: "string?",
	compressionMode: type.valueOf(COMPRESSION_MODES).optional(),
});

export type UpdateRepositoryBody = typeof updateRepositoryBody.infer;

export const updateRepositoryResponse = repositorySchema;
export type UpdateRepositoryDto = typeof updateRepositoryResponse.infer;

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
		404: {
			description: "Repository not found",
		},
		409: {
			description: "Repository with this name already exists",
		},
	},
});

/**
 * List snapshots in a repository
 */
export const snapshotSchema = type({
	short_id: "string",
	time: "number",
	paths: "string[]",
	size: "number",
	duration: "number",
	tags: "string[]",
});

const listSnapshotsResponse = snapshotSchema.array();

export type ListSnapshotsDto = typeof listSnapshotsResponse.infer;

export const listSnapshotsFilters = type({
	backupId: "string?",
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

/**
 * Get snapshot details
 */
export const getSnapshotDetailsResponse = snapshotSchema;

export type GetSnapshotDetailsDto = typeof getSnapshotDetailsResponse.infer;

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

/**
 * List files in a snapshot
 */
export const snapshotFileNodeSchema = type({
	name: "string",
	type: "string",
	path: "string",
	uid: "number?",
	gid: "number?",
	size: "number?",
	mode: "number?",
	mtime: "string?",
	atime: "string?",
	ctime: "string?",
});

export const listSnapshotFilesResponse = type({
	snapshot: type({
		id: "string",
		short_id: "string",
		time: "string",
		hostname: "string",
		paths: "string[]",
	}),
	files: snapshotFileNodeSchema.array(),
});

export type ListSnapshotFilesDto = typeof listSnapshotFilesResponse.infer;

export const listSnapshotFilesQuery = type({
	path: "string?",
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

/**
 * Restore a snapshot
 */
export const overwriteModeSchema = type.valueOf(OVERWRITE_MODES);

export const restoreSnapshotBody = type({
	snapshotId: "string",
	include: "string[]?",
	exclude: "string[]?",
	excludeXattr: "string[]?",
	delete: "boolean?",
	targetPath: "string?",
	overwrite: overwriteModeSchema.optional(),
});

export type RestoreSnapshotBody = typeof restoreSnapshotBody.infer;

export const restoreSnapshotResponse = type({
	success: "boolean",
	message: "string",
	filesRestored: "number",
	filesSkipped: "number",
});

export type RestoreSnapshotDto = typeof restoreSnapshotResponse.infer;

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

/**
 * Doctor a repository (unlock, check, repair)
 */
export const doctorStepSchema = type({
	step: "string",
	success: "boolean",
	output: "string | null",
	error: "string | null",
});

export const doctorRepositoryResponse = type({
	success: "boolean",
	steps: doctorStepSchema.array(),
});

export type DoctorRepositoryDto = typeof doctorRepositoryResponse.infer;

export const doctorRepositoryDto = describeRoute({
	description:
		"Run doctor operations on a repository to fix common issues (unlock, check, repair index). Use this when the repository is locked or has errors.",
	tags: ["Repositories"],
	operationId: "doctorRepository",
	responses: {
		200: {
			description: "Doctor operation completed",
			content: {
				"application/json": {
					schema: resolver(doctorRepositoryResponse),
				},
			},
		},
	},
});

/**
 * List rclone available remotes
 */
const rcloneRemoteSchema = type({
	name: "string",
	type: "string",
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

/**
 * Delete a snapshot
 */
export const deleteSnapshotResponse = type({
	message: "string",
});

export type DeleteSnapshotDto = typeof deleteSnapshotResponse.infer;

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

/**
 * Delete multiple snapshots
 */
export const deleteSnapshotsBody = type({
	snapshotIds: "string[]>=1",
});

export const deleteSnapshotsResponse = type({
	message: "string",
});

export type DeleteSnapshotsResponseDto = typeof deleteSnapshotsResponse.infer;

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

/**
 * Tag multiple snapshots
 */
export const tagSnapshotsBody = type({
	snapshotIds: "string[]>=1",
	add: "string[]?",
	remove: "string[]?",
	set: "string[]?",
});

export const tagSnapshotsResponse = type({
	message: "string",
});

export type TagSnapshotsResponseDto = typeof tagSnapshotsResponse.infer;

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
