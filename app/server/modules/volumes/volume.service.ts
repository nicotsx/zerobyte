import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { and, eq, ne } from "drizzle-orm";
import { ConflictError, InternalServerError, NotFoundError } from "http-errors-enhanced";
import slugify from "slugify";
import { db } from "../../db/db";
import { volumesTable } from "../../db/schema";
import { cryptoUtils } from "../../utils/crypto";
import { toMessage } from "../../utils/errors";
import { generateShortId } from "../../utils/id";
import { getStatFs, type StatFs } from "../../utils/mountinfo";
import { withTimeout } from "../../utils/timeout";
import { createVolumeBackend } from "../backends/backend";
import type { UpdateVolumeBody } from "./volume.dto";
import { getVolumePath } from "./helpers";
import { logger } from "../../utils/logger";
import { serverEvents } from "../../core/events";
import { volumeConfigSchema, type BackendConfig } from "~/schemas/volumes";
import { type } from "arktype";

async function encryptSensitiveFields(config: BackendConfig): Promise<BackendConfig> {
	switch (config.backend) {
		case "smb":
			return {
				...config,
				password: await cryptoUtils.sealSecret(config.password),
			};
		case "webdav":
			return {
				...config,
				password: config.password ? await cryptoUtils.sealSecret(config.password) : undefined,
			};
		case "sftp":
			return {
				...config,
				password: config.password ? await cryptoUtils.sealSecret(config.password) : undefined,
				privateKey: config.privateKey ? await cryptoUtils.sealSecret(config.privateKey) : undefined,
			};
		default:
			return config;
	}
}

const listVolumes = async (organizationId: string) => {
	const volumes = await db.query.volumesTable.findMany({
		where: eq(volumesTable.organizationId, organizationId),
	});

	return volumes;
};

const createVolume = async (name: string, backendConfig: BackendConfig, organizationId: string) => {
	const slug = slugify(name, { lower: true, strict: true });

	const existing = await db.query.volumesTable.findFirst({
		where: and(eq(volumesTable.name, slug), eq(volumesTable.organizationId, organizationId)),
	});

	if (existing) {
		throw new ConflictError("Volume already exists");
	}

	const shortId = generateShortId();
	const encryptedConfig = await encryptSensitiveFields(backendConfig);

	const [created] = await db
		.insert(volumesTable)
		.values({
			shortId,
			name: slug,
			config: encryptedConfig,
			type: backendConfig.backend,
			organizationId,
		})
		.returning();

	if (!created) {
		throw new InternalServerError("Failed to create volume");
	}

	const backend = createVolumeBackend(created);
	const { error, status } = await backend.mount();

	await db
		.update(volumesTable)
		.set({ status, lastError: error ?? null, lastHealthCheck: Date.now() })
		.where(eq(volumesTable.name, slug));

	return { volume: created, status: 201 };
};

const deleteVolume = async (name: string, organizationId: string) => {
	const volume = await db.query.volumesTable.findFirst({
		where: and(eq(volumesTable.name, name), eq(volumesTable.organizationId, organizationId)),
	});

	if (!volume) {
		throw new NotFoundError("Volume not found");
	}

	const backend = createVolumeBackend(volume);
	await backend.unmount();
	await db.delete(volumesTable).where(eq(volumesTable.name, name));
};

const mountVolume = async (name: string, organizationId: string) => {
	const volume = await db.query.volumesTable.findFirst({
		where: and(eq(volumesTable.name, name), eq(volumesTable.organizationId, organizationId)),
	});

	if (!volume) {
		throw new NotFoundError("Volume not found");
	}

	const backend = createVolumeBackend(volume);
	const { error, status } = await backend.mount();

	await db
		.update(volumesTable)
		.set({ status, lastError: error ?? null, lastHealthCheck: Date.now() })
		.where(eq(volumesTable.name, name));

	if (status === "mounted") {
		serverEvents.emit("volume:mounted", { volumeName: name });
	}

	return { error, status };
};

const unmountVolume = async (name: string, organizationId: string) => {
	const volume = await db.query.volumesTable.findFirst({
		where: and(eq(volumesTable.name, name), eq(volumesTable.organizationId, organizationId)),
	});

	if (!volume) {
		throw new NotFoundError("Volume not found");
	}

	const backend = createVolumeBackend(volume);
	const { status, error } = await backend.unmount();

	await db.update(volumesTable).set({ status }).where(eq(volumesTable.name, name));

	if (status === "unmounted") {
		serverEvents.emit("volume:unmounted", { volumeName: name });
	}

	return { error, status };
};

const getVolume = async (name: string, organizationId: string) => {
	const volume = await db.query.volumesTable.findFirst({
		where: and(eq(volumesTable.name, name), eq(volumesTable.organizationId, organizationId)),
	});

	if (!volume) {
		throw new NotFoundError("Volume not found");
	}

	let statfs: Partial<StatFs> = {};
	if (volume.status === "mounted") {
		statfs = await withTimeout(getStatFs(getVolumePath(volume)), 1000, "getStatFs").catch((error) => {
			logger.warn(`Failed to get statfs for volume ${name}: ${toMessage(error)}`);
			return {};
		});
	}

	return { volume, statfs };
};

const updateVolume = async (name: string, volumeData: UpdateVolumeBody, organizationId: string) => {
	const existing = await db.query.volumesTable.findFirst({
		where: and(eq(volumesTable.name, name), eq(volumesTable.organizationId, organizationId)),
	});

	if (!existing) {
		throw new NotFoundError("Volume not found");
	}

	let newName = existing.name;
	if (volumeData.name !== undefined && volumeData.name !== existing.name) {
		const newSlug = slugify(volumeData.name, { lower: true, strict: true });

		const conflict = await db.query.volumesTable.findFirst({
			where: and(eq(volumesTable.name, newSlug), ne(volumesTable.id, existing.id), eq(volumesTable.organizationId, organizationId)),
		});

		if (conflict) {
			throw new ConflictError("A volume with this name already exists");
		}

		newName = newSlug;
	}

	const configChanged =
		JSON.stringify(existing.config) !== JSON.stringify(volumeData.config) && volumeData.config !== undefined;

	if (configChanged) {
		logger.debug("Unmounting existing volume before applying new config");
		const backend = createVolumeBackend(existing);
		await backend.unmount();
	}

	const newConfig = volumeConfigSchema(volumeData.config || existing.config);
	if (newConfig instanceof type.errors) {
		throw new InternalServerError("Invalid volume configuration");
	}

	const encryptedConfig = await encryptSensitiveFields(newConfig);

	const [updated] = await db
		.update(volumesTable)
		.set({
			name: newName,
			config: encryptedConfig,
			type: volumeData.config?.backend,
			autoRemount: volumeData.autoRemount,
			updatedAt: Date.now(),
		})
		.where(eq(volumesTable.id, existing.id))
		.returning();

	if (!updated) {
		throw new InternalServerError("Failed to update volume");
	}

	if (configChanged) {
		const backend = createVolumeBackend(updated);
		const { error, status } = await backend.mount();
		await db
			.update(volumesTable)
			.set({ status, lastError: error ?? null, lastHealthCheck: Date.now() })
			.where(eq(volumesTable.id, existing.id));

		serverEvents.emit("volume:updated", { volumeName: updated.name });
	}

	return { volume: updated };
};

const testConnection = async (backendConfig: BackendConfig) => {
	const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "zerobyte-test-"));

	const mockVolume = {
		id: 0,
		shortId: "test",
		name: "test-connection",
		path: tempDir,
		config: backendConfig,
		createdAt: Date.now(),
		updatedAt: Date.now(),
		lastHealthCheck: Date.now(),
		type: backendConfig.backend,
		status: "unmounted" as const,
		lastError: null,
		autoRemount: true,
		organizationId: "test-org",
	};

	const backend = createVolumeBackend(mockVolume);
	const { error } = await backend.mount();

	await backend.unmount();

	await fs.access(tempDir);
	await fs.rm(tempDir, { recursive: true, force: true });

	return {
		success: !error,
		message: error ? toMessage(error) : "Connection successful",
	};
};

const checkHealth = async (name: string, organizationId: string) => {
	const volume = await db.query.volumesTable.findFirst({
		where: and(eq(volumesTable.name, name), eq(volumesTable.organizationId, organizationId)),
	});

	if (!volume) {
		throw new NotFoundError("Volume not found");
	}

	const backend = createVolumeBackend(volume);
	const { error, status } = await backend.checkHealth();

	if (status !== volume.status) {
		serverEvents.emit("volume:status_changed", { volumeName: name, status });
	}

	await db
		.update(volumesTable)
		.set({ lastHealthCheck: Date.now(), status, lastError: error ?? null })
		.where(eq(volumesTable.name, volume.name));

	return { status, error };
};

const listFiles = async (name: string, organizationId: string, subPath?: string) => {
	const volume = await db.query.volumesTable.findFirst({
		where: and(eq(volumesTable.name, name), eq(volumesTable.organizationId, organizationId)),
	});

	if (!volume) {
		throw new NotFoundError("Volume not found");
	}

	if (volume.status !== "mounted") {
		throw new InternalServerError("Volume is not mounted");
	}

	// For directory volumes, use the configured path directly
	const volumePath = getVolumePath(volume);

	const requestedPath = subPath ? path.join(volumePath, subPath) : volumePath;

	const normalizedPath = path.normalize(requestedPath);
	if (!normalizedPath.startsWith(volumePath)) {
		throw new InternalServerError("Invalid path");
	}

	try {
		const entries = await fs.readdir(normalizedPath, { withFileTypes: true });

		const files = await Promise.all(
			entries.map(async (entry) => {
				const fullPath = path.join(normalizedPath, entry.name);
				const relativePath = path.relative(volumePath, fullPath);

				try {
					const stats = await fs.stat(fullPath);
					return {
						name: entry.name,
						path: `/${relativePath}`,
						type: entry.isDirectory() ? ("directory" as const) : ("file" as const),
						size: entry.isFile() ? stats.size : undefined,
						modifiedAt: stats.mtimeMs,
					};
				} catch {
					return {
						name: entry.name,
						path: `/${relativePath}`,
						type: entry.isDirectory() ? ("directory" as const) : ("file" as const),
						size: undefined,
						modifiedAt: undefined,
					};
				}
			}),
		);

		return {
			files: files.sort((a, b) => {
				if (a.type !== b.type) {
					return a.type === "directory" ? -1 : 1;
				}
				return a.name.localeCompare(b.name);
			}),
			path: subPath || "/",
		};
	} catch (error) {
		throw new InternalServerError(`Failed to list files: ${toMessage(error)}`);
	}
};

const browseFilesystem = async (browsePath: string) => {
	const normalizedPath = path.normalize(browsePath);

	try {
		const entries = await fs.readdir(normalizedPath, { withFileTypes: true });

		const directories = await Promise.all(
			entries
				.filter((entry) => entry.isDirectory())
				.map(async (entry) => {
					const fullPath = path.join(normalizedPath, entry.name);

					try {
						const stats = await fs.stat(fullPath);
						return {
							name: entry.name,
							path: fullPath,
							type: "directory" as const,
							size: undefined,
							modifiedAt: stats.mtimeMs,
						};
					} catch {
						return {
							name: entry.name,
							path: fullPath,
							type: "directory" as const,
							size: undefined,
							modifiedAt: undefined,
						};
					}
				}),
		);

		return {
			directories: directories.sort((a, b) => a.name.localeCompare(b.name)),
			path: normalizedPath,
		};
	} catch (error) {
		throw new InternalServerError(`Failed to browse filesystem: ${toMessage(error)}`);
	}
};

export const volumeService = {
	listVolumes,
	createVolume,
	mountVolume,
	deleteVolume,
	getVolume,
	updateVolume,
	testConnection,
	unmountVolume,
	checkHealth,
	listFiles,
	browseFilesystem,
};
