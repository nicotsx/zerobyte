import { type } from "arktype";
import { describeRoute, resolver } from "hono-openapi";
import { BACKEND_STATUS, BACKEND_TYPES, volumeConfigSchema } from "~/schemas/volumes";

export const volumeSchema = type({
	id: "number",
	shortId: "string",
	name: "string",
	type: type.valueOf(BACKEND_TYPES),
	status: type.valueOf(BACKEND_STATUS),
	lastError: "string | null",
	createdAt: "number",
	updatedAt: "number",
	lastHealthCheck: "number",
	config: volumeConfigSchema,
	autoRemount: "boolean",
});

export type VolumeDto = typeof volumeSchema.infer;

/**
 * List all volumes
 */
export const listVolumesResponse = volumeSchema.array();
export type ListVolumesDto = typeof listVolumesResponse.infer;

export const listVolumesDto = describeRoute({
	description: "List all volumes",
	tags: ["Volumes"],
	operationId: "listVolumes",
	responses: {
		200: {
			description: "A list of volumes",
			content: {
				"application/json": {
					schema: resolver(listVolumesResponse),
				},
			},
		},
	},
});

/**
 * Create a new volume
 */
export const createVolumeBody = type({
	name: "string",
	config: volumeConfigSchema,
});

export const createVolumeResponse = volumeSchema;
export type CreateVolumeDto = typeof createVolumeResponse.infer;

export const createVolumeDto = describeRoute({
	description: "Create a new volume",
	operationId: "createVolume",
	tags: ["Volumes"],
	responses: {
		201: {
			description: "Volume created successfully",
			content: {
				"application/json": {
					schema: resolver(createVolumeResponse),
				},
			},
		},
	},
});

/**
 * Delete a volume
 */
export const deleteVolumeResponse = type({
	message: "string",
});
export type DeleteVolumeDto = typeof deleteVolumeResponse.infer;

export const deleteVolumeDto = describeRoute({
	description: "Delete a volume",
	operationId: "deleteVolume",
	tags: ["Volumes"],
	responses: {
		200: {
			description: "Volume deleted successfully",
			content: {
				"application/json": {
					schema: resolver(deleteVolumeResponse),
				},
			},
		},
	},
});

const statfsSchema = type({
	total: "number",
	used: "number",
	free: "number",
});

const getVolumeResponse = type({
	volume: volumeSchema,
	statfs: statfsSchema,
});

export type GetVolumeDto = typeof getVolumeResponse.infer;
/**
 * Get a volume
 */
export const getVolumeDto = describeRoute({
	description: "Get a volume by name",
	operationId: "getVolume",
	tags: ["Volumes"],
	responses: {
		200: {
			description: "Volume details",
			content: {
				"application/json": {
					schema: resolver(getVolumeResponse),
				},
			},
		},
		404: {
			description: "Volume not found",
		},
	},
});

/**
 * Update a volume
 */
export const updateVolumeBody = type({
	name: "string?",
	autoRemount: "boolean?",
	config: volumeConfigSchema.optional(),
});

export type UpdateVolumeBody = typeof updateVolumeBody.infer;

export const updateVolumeResponse = volumeSchema;
export type UpdateVolumeDto = typeof updateVolumeResponse.infer;

export const updateVolumeDto = describeRoute({
	description: "Update a volume's configuration",
	operationId: "updateVolume",
	tags: ["Volumes"],
	responses: {
		200: {
			description: "Volume updated successfully",
			content: {
				"application/json": {
					schema: resolver(updateVolumeResponse),
				},
			},
		},
		404: {
			description: "Volume not found",
		},
	},
});

/**
 * Test connection
 */
export const testConnectionBody = type({
	config: volumeConfigSchema,
});

export const testConnectionResponse = type({
	success: "boolean",
	message: "string",
});
export type TestConnectionDto = typeof testConnectionResponse.infer;

export const testConnectionDto = describeRoute({
	description: "Test connection to backend",
	operationId: "testConnection",
	tags: ["Volumes"],
	responses: {
		200: {
			description: "Connection test result",
			content: {
				"application/json": {
					schema: resolver(testConnectionResponse),
				},
			},
		},
	},
});

/**
 * Mount volume
 */
export const mountVolumeResponse = type({
	error: "string?",
	status: type.valueOf(BACKEND_STATUS),
});
export type MountVolumeDto = typeof mountVolumeResponse.infer;

export const mountVolumeDto = describeRoute({
	description: "Mount a volume",
	operationId: "mountVolume",
	tags: ["Volumes"],
	responses: {
		200: {
			description: "Volume mounted successfully",
			content: {
				"application/json": {
					schema: resolver(mountVolumeResponse),
				},
			},
		},
	},
});

/**
 * Unmount volume
 */
export const unmountVolumeResponse = type({
	error: "string?",
	status: type.valueOf(BACKEND_STATUS),
});
export type UnmountVolumeDto = typeof unmountVolumeResponse.infer;

export const unmountVolumeDto = describeRoute({
	description: "Unmount a volume",
	operationId: "unmountVolume",
	tags: ["Volumes"],
	responses: {
		200: {
			description: "Volume unmounted successfully",
			content: {
				"application/json": {
					schema: resolver(unmountVolumeResponse),
				},
			},
		},
	},
});

export const healthCheckResponse = type({
	error: "string?",
	status: type.valueOf(BACKEND_STATUS),
});
export type HealthCheckDto = typeof healthCheckResponse.infer;

export const healthCheckDto = describeRoute({
	description: "Perform a health check on a volume",
	operationId: "healthCheckVolume",
	tags: ["Volumes"],
	responses: {
		200: {
			description: "Volume health check result",
			content: {
				"application/json": {
					schema: resolver(healthCheckResponse),
				},
			},
		},
		404: {
			description: "Volume not found",
		},
	},
});

/**
 * List files in a volume
 */
const fileEntrySchema = type({
	name: "string",
	path: "string",
	type: type.enumerated("file", "directory"),
	size: "number?",
	modifiedAt: "number?",
});

export const listFilesResponse = type({
	files: fileEntrySchema.array(),
	path: "string",
	offset: "number",
	limit: "number",
	total: "number",
	hasMore: "boolean",
});
export type ListFilesDto = typeof listFilesResponse.infer;

export const listFilesQuery = type({
	path: "string?",
	offset: "string.integer?",
	limit: "string.integer?",
});

export const listFilesDto = describeRoute({
	description: "List files in a volume directory",
	operationId: "listFiles",
	tags: ["Volumes"],
	responses: {
		200: {
			description: "List of files in the volume",
			content: {
				"application/json": {
					schema: resolver(listFilesResponse),
				},
			},
		},
	},
});

/**
 * Browse filesystem directories
 */
export const browseFilesystemResponse = type({
	directories: fileEntrySchema.array(),
	path: "string",
});
export type BrowseFilesystemDto = typeof browseFilesystemResponse.infer;

export const browseFilesystemDto = describeRoute({
	description: "Browse directories on the host filesystem",
	operationId: "browseFilesystem",
	tags: ["Volumes"],
	parameters: [
		{
			in: "query",
			name: "path",
			required: false,
			schema: {
				type: "string",
			},
			description: "Directory path to browse (absolute path, defaults to /)",
		},
	],
	responses: {
		200: {
			description: "List of directories in the specified path",
			content: {
				"application/json": {
					schema: resolver(browseFilesystemResponse),
				},
			},
		},
	},
});
