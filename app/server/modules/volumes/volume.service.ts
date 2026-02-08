import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { and, eq } from "drizzle-orm";
import { BadRequestError, InternalServerError, NotFoundError } from "http-errors-enhanced";
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
import { getOrganizationId } from "~/server/core/request-context";
import { isNodeJSErrnoException } from "~/server/utils/fs";

async function encryptSensitiveFields(config: BackendConfig): Promise<BackendConfig> {
	switch (config.backend) {
		case "smb":
			return {
				...config,
				password: config.password ? await cryptoUtils.sealSecret(config.password) : undefined,
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

const listVolumes = async () => {
	const organizationId = getOrganizationId();
	const volumes = await db.query.volumesTable.findMany({
		where: { organizationId: organizationId },
	});

	return volumes;
};

const findVolume = async (idOrShortId: string | number) => {
	const organizationId = getOrganizationId();
	return await db.query.volumesTable.findFirst({
		where: {
			AND: [
				{ OR: [{ id: Number(idOrShortId) }, { shortId: String(idOrShortId) }] },
				{ organizationId: organizationId },
			],
		},
	});
};

const createVolume = async (name: string, backendConfig: BackendConfig) => {
	const organizationId = getOrganizationId();
	const trimmedName = name.trim();

	if (trimmedName.length === 0) {
		throw new BadRequestError("Volume name cannot be empty");
	}

	const shortId = generateShortId();
	const encryptedConfig = await encryptSensitiveFields(backendConfig);

	const [created] = await db
		.insert(volumesTable)
		.values({
			shortId,
			name: trimmedName,
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
		.where(and(eq(volumesTable.id, created.id), eq(volumesTable.organizationId, organizationId)));

	return { volume: created, status: 201 };
};

const deleteVolume = async (idOrShortId: string | number) => {
	const organizationId = getOrganizationId();
	const volume = await findVolume(idOrShortId);

	if (!volume) {
		throw new NotFoundError("Volume not found");
	}

	const backend = createVolumeBackend(volume);
	await backend.unmount();
	await db
		.delete(volumesTable)
		.where(and(eq(volumesTable.id, volume.id), eq(volumesTable.organizationId, organizationId)));
};

const mountVolume = async (idOrShortId: string | number) => {
	const organizationId = getOrganizationId();
	const volume = await findVolume(idOrShortId);

	if (!volume) {
		throw new NotFoundError("Volume not found");
	}

	const backend = createVolumeBackend(volume);
	const { error, status } = await backend.mount();

	await db
		.update(volumesTable)
		.set({ status, lastError: error ?? null, lastHealthCheck: Date.now() })
		.where(and(eq(volumesTable.id, volume.id), eq(volumesTable.organizationId, organizationId)));

	if (status === "mounted") {
		serverEvents.emit("volume:mounted", { organizationId, volumeName: volume.name });
	}

	return { error, status };
};

const unmountVolume = async (idOrShortId: string | number) => {
	const organizationId = getOrganizationId();
	const volume = await findVolume(idOrShortId);

	if (!volume) {
		throw new NotFoundError("Volume not found");
	}

	const backend = createVolumeBackend(volume);
	const { status, error } = await backend.unmount();

	await db
		.update(volumesTable)
		.set({ status })
		.where(and(eq(volumesTable.id, volume.id), eq(volumesTable.organizationId, organizationId)));

	if (status === "unmounted") {
		serverEvents.emit("volume:unmounted", { organizationId, volumeName: volume.name });
	}

	return { error, status };
};

const getVolume = async (idOrShortId: string | number) => {
	const volume = await findVolume(idOrShortId);

	if (!volume) {
		throw new NotFoundError("Volume not found");
	}

	let statfs: Partial<StatFs> = {};
	if (volume.status === "mounted") {
		statfs = await withTimeout(getStatFs(getVolumePath(volume)), 1000, "getStatFs").catch((error) => {
			logger.warn(`Failed to get statfs for volume ${volume.name}: ${toMessage(error)}`);
			return {};
		});
	}

	return { volume, statfs };
};

const updateVolume = async (idOrShortId: string | number, volumeData: UpdateVolumeBody) => {
	const organizationId = getOrganizationId();
	const existing = await findVolume(idOrShortId);

	if (!existing) {
		throw new NotFoundError("Volume not found");
	}

	const newName = volumeData.name !== undefined ? volumeData.name.trim() : existing.name;

	if (newName.length === 0) {
		throw new BadRequestError("Volume name cannot be empty");
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
		throw new BadRequestError("Invalid volume configuration");
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
		.where(and(eq(volumesTable.id, existing.id), eq(volumesTable.organizationId, organizationId)))
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
			.where(and(eq(volumesTable.id, existing.id), eq(volumesTable.organizationId, organizationId)));

		serverEvents.emit("volume:updated", { organizationId, volumeName: updated.name });
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

const checkHealth = async (idOrShortId: string | number) => {
	const organizationId = getOrganizationId();
	const volume = await findVolume(idOrShortId);

	if (!volume) {
		throw new NotFoundError("Volume not found");
	}

	const backend = createVolumeBackend(volume);
	const { error, status } = await backend.checkHealth();

	if (status !== volume.status) {
		serverEvents.emit("volume:status_changed", { organizationId, volumeName: volume.name, status });
	}

	await db
		.update(volumesTable)
		.set({ lastHealthCheck: Date.now(), status, lastError: error ?? null })
		.where(and(eq(volumesTable.id, volume.id), eq(volumesTable.organizationId, organizationId)));

	return { status, error };
};

const DEFAULT_PAGE_SIZE = 500;
const MAX_PAGE_SIZE = 500;

const listFiles = async (
	idOrShortId: string | number,
	subPath?: string,
	offset: number = 0,
	limit: number = DEFAULT_PAGE_SIZE,
) => {
	const volume = await findVolume(idOrShortId);

	if (!volume) {
		throw new NotFoundError("Volume not found");
	}

	if (volume.status !== "mounted") {
		throw new InternalServerError("Volume is not mounted");
	}

	const volumePath = getVolumePath(volume);
	const requestedPath = subPath ? path.join(volumePath, subPath) : volumePath;
	const normalizedPath = path.normalize(requestedPath);
	const relative = path.relative(volumePath, normalizedPath);

	if (relative.startsWith("..") || path.isAbsolute(relative)) {
		throw new BadRequestError("Invalid path");
	}

	const pageSize = Math.min(Math.max(limit, 1), MAX_PAGE_SIZE);
	const startOffset = Math.max(offset, 0);

	try {
		const dirents = await fs.readdir(normalizedPath, { withFileTypes: true });

		dirents.sort((a, b) => {
			const aIsDir = a.isDirectory();
			const bIsDir = b.isDirectory();

			if (aIsDir === bIsDir) {
				return a.name.localeCompare(b.name);
			}
			return aIsDir ? -1 : 1;
		});

		const total = dirents.length;
		const paginatedDirents = dirents.slice(startOffset, startOffset + pageSize);

		const entries = (
			await Promise.all(
				paginatedDirents.map(async (dirent) => {
					const fullPath = path.join(normalizedPath, dirent.name);

					try {
						const stats = await fs.stat(fullPath);
						const relativePath = path.relative(volumePath, fullPath);

						return {
							name: dirent.name,
							path: `/${relativePath}`,
							type: dirent.isDirectory() ? ("directory" as const) : ("file" as const),
							size: dirent.isFile() ? stats.size : undefined,
							modifiedAt: stats.mtimeMs,
						};
					} catch {
						return null;
					}
				}),
			)
		).filter((e) => e !== null);

		return {
			files: entries,
			path: subPath || "/",
			offset: startOffset,
			limit: pageSize,
			total,
			hasMore: startOffset + pageSize < total,
		};
	} catch (error) {
		if (isNodeJSErrnoException(error) && error.code === "ENOENT") {
			throw new NotFoundError("Directory not found");
		}
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
