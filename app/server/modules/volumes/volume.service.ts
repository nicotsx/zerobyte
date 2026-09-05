import { and, eq } from "drizzle-orm";
import { BadRequestError, InternalServerError, NotFoundError } from "http-errors-enhanced";
import { db } from "../../db/db";
import { volumesTable } from "../../db/schema";
import { toMessage } from "../../utils/errors";
import { generateShortId } from "../../utils/id";
import { withTimeout } from "../../utils/timeout";
import { LOCAL_AGENT_ID } from "../agents/constants";
import { createVolumeBackend } from "./volume-host";
import { getVolumePath } from "./helpers";
import type { StatFs } from "@zerobyte/core/filesystem";
import { agentManager } from "../agents/agents-manager";
import { testVolumeConnection } from "./volume-host/operations";
import { Effect } from "effect";
import type { UpdateVolumeBody } from "./volume.dto";
import { logger } from "@zerobyte/core/node";
import { serverEvents } from "../../core/events";
import type { Volume } from "../../db/schema";
import { volumeConfigSchema, type BackendConfig } from "@zerobyte/contracts/volumes";
import { getOrganizationId } from "~/server/core/request-context";
import { type ShortId } from "~/server/utils/branded";
import { normalizeRequiredName } from "~/server/utils/names";
import { decryptVolumeConfig, encryptVolumeConfig } from "./volume-config-secrets";

type EnsureHealthyVolumeResult =
	| { ready: true; volume: Volume; remounted: boolean }
	| { ready: false; volume: Volume; reason: string };

const listVolumes = async () => {
	const organizationId = getOrganizationId();
	const volumes = await db.query.volumesTable.findMany({
		where: { organizationId: organizationId },
		orderBy: { id: "asc" },
	});

	return volumes;
};

const findVolume = async (shortId: ShortId) => {
	const organizationId = getOrganizationId();
	return await db.query.volumesTable.findFirst({
		where: {
			AND: [{ shortId: { eq: shortId } }, { organizationId: organizationId }],
		},
	});
};

const runVolumeBackendOperation = async (volume: Volume, operation: "mount" | "unmount" | "checkHealth") => {
	const config = await decryptVolumeConfig(volume.config);
	return createVolumeBackend({ ...volume, config })[operation]();
};

const createVolume = async (name: string, backendConfig: BackendConfig) => {
	const organizationId = getOrganizationId();
	const normalizedName = normalizeRequiredName(name);

	if (normalizedName === null) {
		throw new BadRequestError("Volume name cannot be empty");
	}

	const shortId = generateShortId();
	const encryptedConfig = await encryptVolumeConfig(backendConfig);

	const [created] = await db
		.insert(volumesTable)
		.values({
			shortId,
			name: normalizedName,
			config: encryptedConfig,
			type: backendConfig.backend,
			agentId: LOCAL_AGENT_ID,
			organizationId,
		})
		.returning();

	if (!created) {
		throw new InternalServerError("Failed to create volume");
	}

	const { error, status } = await runVolumeBackendOperation(created, "mount");

	await db
		.update(volumesTable)
		.set({ status, lastError: error ?? null, lastHealthCheck: Date.now() })
		.where(and(eq(volumesTable.id, created.id), eq(volumesTable.organizationId, organizationId)));

	return { volume: created, status: 201 };
};

const deleteVolume = async (shortId: ShortId) => {
	const organizationId = getOrganizationId();
	const volume = await findVolume(shortId);

	if (!volume) {
		throw new NotFoundError("Volume not found");
	}

	await runVolumeBackendOperation(volume, "unmount");
	await db
		.delete(volumesTable)
		.where(and(eq(volumesTable.id, volume.id), eq(volumesTable.organizationId, organizationId)));
};

const mountVolume = async (shortId: ShortId, signal?: AbortSignal) => {
	signal?.throwIfAborted();

	const organizationId = getOrganizationId();
	const volume = await findVolume(shortId);

	if (!volume) {
		throw new NotFoundError("Volume not found");
	}

	if (volume.type === "directory") {
		return checkHealth(shortId);
	}

	const unmount = await runVolumeBackendOperation(volume, "unmount");

	if (signal?.aborted) {
		const lastError = unmount.error ?? "Volume is not mounted";
		await db
			.update(volumesTable)
			.set({ status: "error", lastError, lastHealthCheck: Date.now() })
			.where(and(eq(volumesTable.id, volume.id), eq(volumesTable.organizationId, organizationId)));

		if (volume.status !== "error") {
			serverEvents.emit("volume:status_changed", { organizationId, volumeName: volume.name, status: "error" });
		}

		signal.throwIfAborted();
	}

	const { error, status } = await runVolumeBackendOperation(volume, "mount");

	await db
		.update(volumesTable)
		.set({ status, lastError: error ?? null, lastHealthCheck: Date.now() })
		.where(and(eq(volumesTable.id, volume.id), eq(volumesTable.organizationId, organizationId)));

	if (status === "mounted") {
		serverEvents.emit("volume:mounted", { organizationId, volumeName: volume.name });
	}

	return { error, status };
};

const unmountVolume = async (shortId: ShortId, options?: { persistStatus?: boolean }) => {
	const organizationId = getOrganizationId();
	const volume = await findVolume(shortId);

	if (!volume) {
		throw new NotFoundError("Volume not found");
	}

	const { status, error } = await runVolumeBackendOperation(volume, "unmount");

	if (options?.persistStatus !== false) {
		await db
			.update(volumesTable)
			.set({ status })
			.where(and(eq(volumesTable.id, volume.id), eq(volumesTable.organizationId, organizationId)));

		if (status === "unmounted") {
			serverEvents.emit("volume:unmounted", { organizationId, volumeName: volume.name });
		}
	}

	return { error, status };
};

const getVolume = async (shortId: ShortId) => {
	const volume = await findVolume(shortId);

	if (!volume) {
		throw new NotFoundError("Volume not found");
	}

	let statfs: Partial<StatFs> = {};
	if (volume.status === "mounted") {
		const statfsCommand = agentManager
			.runFilesystemCommand(volume.agentId, { name: "filesystem.statfs", path: getVolumePath(volume) })
			.then((response) => {
				if (response.name !== "filesystem.statfs") throw new Error("Unexpected filesystem response");

				return response.result;
			});
		statfs = await withTimeout(statfsCommand, 1000, "filesystem.statfs").catch((error) => {
			logger.warn(`Failed to get statfs for volume ${volume.name}: ${toMessage(error)}`);
			return {};
		});
	}

	return { volume, statfs };
};

const updateVolume = async (shortId: ShortId, volumeData: UpdateVolumeBody) => {
	const organizationId = getOrganizationId();
	const existing = await findVolume(shortId);

	if (!existing) {
		throw new NotFoundError("Volume not found");
	}

	const normalizedName = volumeData.name !== undefined ? normalizeRequiredName(volumeData.name) : existing.name;

	if (normalizedName === null) {
		throw new BadRequestError("Volume name cannot be empty");
	}

	const configChanged =
		JSON.stringify(existing.config) !== JSON.stringify(volumeData.config) && volumeData.config !== undefined;

	if (configChanged) {
		logger.debug("Unmounting existing volume before applying new config");
		await runVolumeBackendOperation(existing, "unmount");
	}

	const newConfigResult = volumeConfigSchema.safeParse(volumeData.config || existing.config);
	if (!newConfigResult.success) {
		throw new BadRequestError("Invalid volume configuration");
	}
	const newConfig = newConfigResult.data;

	const encryptedConfig = await encryptVolumeConfig(newConfig);

	const [updated] = await db
		.update(volumesTable)
		.set({
			name: normalizedName,
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
		const { error, status } = await runVolumeBackendOperation(updated, "mount");
		await db
			.update(volumesTable)
			.set({ status, lastError: error ?? null, lastHealthCheck: Date.now() })
			.where(and(eq(volumesTable.id, existing.id), eq(volumesTable.organizationId, organizationId)));

		serverEvents.emit("volume:updated", { organizationId, volumeName: updated.name });
	}

	return { volume: updated };
};

const testConnection = async (backendConfig: BackendConfig) => {
	return Effect.runPromise(testVolumeConnection(backendConfig));
};

const checkHealth = async (shortId: ShortId) => {
	const organizationId = getOrganizationId();
	const volume = await findVolume(shortId);

	if (!volume) {
		throw new NotFoundError("Volume not found");
	}

	const { error, status } = await runVolumeBackendOperation(volume, "checkHealth");

	if (status !== volume.status) {
		serverEvents.emit("volume:status_changed", { organizationId, volumeName: volume.name, status });
	}

	await db
		.update(volumesTable)
		.set({ lastHealthCheck: Date.now(), status, lastError: error ?? null })
		.where(and(eq(volumesTable.id, volume.id), eq(volumesTable.organizationId, organizationId)));

	return { status, error };
};

const ensureHealthyVolume = async (shortId: ShortId, signal?: AbortSignal): Promise<EnsureHealthyVolumeResult> => {
	signal?.throwIfAborted();

	const volume = await findVolume(shortId);

	if (!volume) {
		throw new NotFoundError("Volume not found");
	}

	if (volume.type === "directory") {
		const health = await checkHealth(shortId);
		signal?.throwIfAborted();
		const checkedVolume = { ...volume, status: health.status, lastError: health.error ?? null };

		if (health.status === "mounted") {
			return { ready: true, volume: checkedVolume, remounted: false };
		}

		const reason = health.error ?? "Directory is not accessible";

		return { ready: false, volume: checkedVolume, reason };
	}

	if (volume.status === "unmounted") {
		return { ready: false, volume, reason: volume.lastError ?? "Volume is not mounted" };
	}

	let failureReason = volume.lastError ?? "Volume health check failed";
	let failedVolume = volume;

	if (volume.status !== "error") {
		const health = await checkHealth(shortId);
		signal?.throwIfAborted();

		if (health.status === "mounted") {
			return {
				ready: true,
				volume: { ...volume, status: "mounted", lastError: null },
				remounted: false,
			};
		}

		failureReason = health.error ?? failureReason;
		failedVolume = { ...volume, status: "error", lastError: health.error ?? null };
	}

	if (!volume.autoRemount) {
		return { ready: false, volume: failedVolume, reason: failureReason };
	}

	logger.warn(
		`${volume.name} is not healthy. Auto-remount is enabled, attempting to remount. Reason: ${failureReason}`,
	);
	signal?.throwIfAborted();
	const remount = await mountVolume(shortId, signal);

	if (remount.status !== "mounted") {
		return {
			ready: false,
			volume: { ...volume, status: remount.status, lastError: remount.error ?? null },
			reason: remount.error ?? failureReason,
		};
	}

	return {
		ready: true,
		volume: { ...volume, status: "mounted", lastError: null },
		remounted: true,
	};
};

const DEFAULT_PAGE_SIZE = 500;

const listFiles = async (shortId: ShortId, subPath?: string, offset: number = 0, limit: number = DEFAULT_PAGE_SIZE) => {
	const volume = await findVolume(shortId);

	if (!volume) {
		throw new NotFoundError("Volume not found");
	}

	if (volume.status !== "mounted") {
		throw new InternalServerError("Volume is not mounted");
	}

	try {
		const response = await agentManager.runFilesystemCommand(volume.agentId, {
			name: "filesystem.listFiles",
			path: getVolumePath(volume),
			subPath,
			offset,
			limit,
		});
		if (response.name !== "filesystem.listFiles") throw new Error("Unexpected filesystem response");

		return response.result;
	} catch (error) {
		throw new InternalServerError(`Failed to list files: ${toMessage(error)}`);
	}
};

const browseFilesystem = async (browsePath: string) => {
	try {
		const response = await agentManager.runFilesystemCommand(LOCAL_AGENT_ID, {
			name: "filesystem.browse",
			path: browsePath,
		});
		if (response.name !== "filesystem.browse") throw new Error("Unexpected filesystem response");

		return response.result;
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
	ensureHealthyVolume,
	listFiles,
	browseFilesystem,
};
