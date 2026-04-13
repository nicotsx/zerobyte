import { z } from "zod";
import { describeRoute, resolver } from "hono-openapi";
import {
	browseFilesystemResponseSchema,
	listVolumeFilesResponseSchema,
	publicVolumeSchema,
	statfsSchema,
	testVolumeConnectionResponseSchema,
	volumeConfigSchema,
	volumeOperationResultSchema,
} from "@zerobyte/contracts/volumes";

export const volumeSchema = publicVolumeSchema;

const listVolumesResponse = volumeSchema.array();
export type ListVolumesDto = z.infer<typeof listVolumesResponse>;

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

export const createVolumeBody = z.object({
	name: z.string(),
	config: volumeConfigSchema,
});

const createVolumeResponse = volumeSchema;
export type CreateVolumeDto = z.infer<typeof createVolumeResponse>;

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

const deleteVolumeResponse = z.object({
	message: z.string(),
});

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

const getVolumeResponse = z.object({
	volume: volumeSchema,
	statfs: statfsSchema,
});

export type GetVolumeDto = z.infer<typeof getVolumeResponse>;

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

export const updateVolumeBody = z.object({
	name: z.string().optional(),
	autoRemount: z.boolean().optional(),
	config: volumeConfigSchema.optional(),
});

export type UpdateVolumeBody = z.infer<typeof updateVolumeBody>;

const updateVolumeResponse = volumeSchema;
export type UpdateVolumeDto = z.infer<typeof updateVolumeResponse>;

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

export const testConnectionBody = z.object({
	config: volumeConfigSchema,
});

const testConnectionResponse = testVolumeConnectionResponseSchema;

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

const mountVolumeResponse = volumeOperationResultSchema;

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

const unmountVolumeResponse = volumeOperationResultSchema;

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

const healthCheckResponse = volumeOperationResultSchema;

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

const listFilesResponse = listVolumeFilesResponseSchema;
export type ListFilesDto = z.infer<typeof listFilesResponse>;

export const listFilesQuery = z.object({
	path: z.string().optional(),
	offset: z.coerce.number().int().optional(),
	limit: z.coerce.number().int().optional(),
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

const browseFilesystemResponse = browseFilesystemResponseSchema;
export type BrowseFilesystemDto = z.infer<typeof browseFilesystemResponse>;

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
