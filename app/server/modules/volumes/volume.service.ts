import { and, eq } from "drizzle-orm";
import { BadRequestError, InternalServerError, NotFoundError } from "http-errors-enhanced";
import { db } from "../../db/db";
import { readVolume } from "../../db/volume";
import { volumesTable } from "../../db/schema";
import { runEffectPromise, toMessage } from "../../utils/errors";
import { generateShortId } from "../../utils/id";
import type { StatFs } from "@zerobyte/core/filesystem";
import { LOCAL_AGENT_ID } from "../agents/constants";
import { testVolumeConnection } from "./volume-host/operations";
import { Effect } from "effect";
import type { CreateVolumeBody, UpdateVolumeBody } from "./volume.dto";
import { logger } from "@zerobyte/core/node";
import { findVolume } from "./volume-queries";
import { volumeLifecycle, runVolumeBackendOperation } from "./volume-lifecycle";
import { serverEvents } from "../../core/events";
import type { Volume } from "../../db/schema";
import {
	normalizeTrustedSourceRelativePath,
	volumeConfigSchema,
	type BackendConfig,
} from "@zerobyte/contracts/volumes";
import { getOrganizationId } from "~/server/core/request-context";
import { type ShortId } from "~/server/utils/branded";
import { normalizeRequiredName } from "~/server/utils/names";
import { encryptVolumeConfig } from "./volume-config-secrets";
import { assembleVolumeExecutionSource, probeSource, runFilesystemCommand } from "./volume-execution-source";
import { listSourceMachines as querySourceMachines, validateTrustedRoot } from "./source-discovery";

const { mountVolume, unmountVolume, checkHealth, ensureHealthyVolume } = volumeLifecycle;

const listVolumes = async () => {
	const organizationId = getOrganizationId();
	const volumes = await db.query.volumesTable.findMany({
		where: { organizationId: organizationId },
		orderBy: { id: "asc" },
	});

	return volumes.map(readVolume);
};

const normalizeRelativePath = (rawPath: string) => {
	try {
		return normalizeTrustedSourceRelativePath(rawPath);
	} catch (error) {
		throw new BadRequestError(toMessage(error));
	}
};

const preflightTrustedFilesystemSource = async (
	agentId: string,
	trustedRootId: string,
	relativePath: string,
	organizationId: string,
	signal?: AbortSignal,
) => {
	await validateTrustedRoot(agentId, trustedRootId, organizationId);

	await runEffectPromise(probeSource(agentId, organizationId, { rootId: trustedRootId, relativePath }), { signal });
};

const createVolume = async (body: CreateVolumeBody, signal?: AbortSignal) => {
	const organizationId = getOrganizationId();
	const normalizedName = normalizeRequiredName(body.name);

	if (normalizedName === null) {
		throw new BadRequestError("Volume name cannot be empty");
	}

	const shortId = generateShortId();
	if (body.sourceKind === "filesystem") {
		const relativePath = normalizeRelativePath(body.relativePath);
		await preflightTrustedFilesystemSource(body.agentId, body.trustedRootId, relativePath, organizationId, signal);
		const [created] = await db
			.insert(volumesTable)
			.values({
				shortId,
				name: normalizedName,
				config: null,
				type: null,
				agentId: body.agentId,
				sourceKind: "filesystem",
				trustedRootId: body.trustedRootId,
				relativePath,
				status: "mounted",
				autoRemount: false,
				organizationId,
			})
			.returning();

		if (!created) {
			throw new InternalServerError("Failed to create filesystem source");
		}
		return { volume: readVolume(created), status: 201 };
	}

	const backendConfig = body.config;
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
			sourceKind: "managed",
		})
		.returning();

	if (!created) {
		throw new InternalServerError("Failed to create volume");
	}

	const volume = readVolume(created);
	const { error, status } = await runVolumeBackendOperation(volume, "mount");

	const [refreshed] = await db
		.update(volumesTable)
		.set({ status, lastError: error ?? null, lastHealthCheck: Date.now() })
		.where(and(eq(volumesTable.id, created.id), eq(volumesTable.organizationId, organizationId)))
		.returning();

	return { volume: refreshed ? readVolume(refreshed) : volume, status: 201 };
};

const deleteVolume = async (shortId: ShortId) => {
	const organizationId = getOrganizationId();
	const volume = await findVolume(shortId);

	if (!volume) {
		throw new NotFoundError("Volume not found");
	}

	if (volume.sourceKind !== "filesystem") {
		await runVolumeBackendOperation(volume, "unmount");
	}
	await db
		.delete(volumesTable)
		.where(and(eq(volumesTable.id, volume.id), eq(volumesTable.organizationId, organizationId)));
};

const getVolume = async (shortId: ShortId, signal?: AbortSignal) => {
	const volume = await findVolume(shortId);

	if (!volume) {
		throw new NotFoundError("Volume not found");
	}

	let statfs: Partial<StatFs> = {};
	if (volume.sourceKind === "managed" && volume.status === "mounted") {
		const organizationId = getOrganizationId();
		statfs = await runEffectPromise(
			probeSource(volume.agentId, organizationId, assembleVolumeExecutionSource(volume)).pipe(
				Effect.timeout("1 second"),
				Effect.catchAll((error) => {
					logger.warn(`Failed to get statfs for volume ${volume.name}: ${toMessage(error)}`);
					return Effect.succeed({});
				}),
			),
			{ signal },
		);
	}

	return { volume, statfs };
};

type VolumeUpdate = UpdateVolumeBody & { name: string };

const updateFilesystemVolume = async (
	existing: Extract<Volume, { sourceKind: "filesystem" }>,
	data: VolumeUpdate,
	signal?: AbortSignal,
) => {
	if (data.config !== undefined || data.autoRemount !== undefined)
		throw new BadRequestError("Filesystem sources cannot have managed backend fields");

	const agentId = data.agentId ?? existing.agentId;
	const trustedRootId = data.trustedRootId ?? existing.trustedRootId;
	const relativePath = normalizeRelativePath(data.relativePath ?? existing.relativePath);
	const locationChanged =
		agentId !== existing.agentId ||
		trustedRootId !== existing.trustedRootId ||
		relativePath !== existing.relativePath;

	if (locationChanged) {
		await preflightTrustedFilesystemSource(agentId, trustedRootId, relativePath, existing.organizationId, signal);
	}

	const updatedAt = Date.now();
	const [updated] = await db
		.update(volumesTable)
		.set({
			name: data.name,
			agentId,
			trustedRootId,
			relativePath,
			updatedAt,
			status: locationChanged ? "mounted" : undefined,
			lastError: locationChanged ? null : undefined,
			lastHealthCheck: locationChanged ? updatedAt : undefined,
		})
		.where(and(eq(volumesTable.id, existing.id), eq(volumesTable.organizationId, existing.organizationId)))
		.returning();

	if (!updated) throw new InternalServerError("Failed to update filesystem source");

	return { volume: readVolume(updated) };
};

const updateManagedVolume = async (existing: Extract<Volume, { sourceKind: "managed" }>, data: VolumeUpdate) => {
	if (data.agentId !== undefined || data.trustedRootId !== undefined || data.relativePath !== undefined)
		throw new BadRequestError("Managed volumes cannot have trusted filesystem locations");

	const parsedConfig = volumeConfigSchema.safeParse(data.config ?? existing.config);
	if (!parsedConfig.success) throw new BadRequestError("Invalid volume configuration");

	const configChanged = data.config !== undefined && JSON.stringify(existing.config) !== JSON.stringify(data.config);
	if (configChanged) {
		await runVolumeBackendOperation(existing, "unmount");
	}

	const config = await encryptVolumeConfig(parsedConfig.data);
	const [updated] = await db
		.update(volumesTable)
		.set({
			name: data.name,
			config,
			type: config.backend,
			autoRemount: data.autoRemount ?? existing.autoRemount,
			updatedAt: Date.now(),
		})
		.where(and(eq(volumesTable.id, existing.id), eq(volumesTable.organizationId, existing.organizationId)))
		.returning();

	if (!updated) throw new InternalServerError("Failed to update volume");

	let volume = readVolume(updated);

	if (configChanged) {
		const { error, status } = await runVolumeBackendOperation(volume, "mount");
		const [refreshed] = await db
			.update(volumesTable)
			.set({ status, lastError: error ?? null, lastHealthCheck: Date.now() })
			.where(and(eq(volumesTable.id, existing.id), eq(volumesTable.organizationId, existing.organizationId)))
			.returning();

		if (refreshed) volume = readVolume(refreshed);

		serverEvents.emit("volume:updated", { organizationId: existing.organizationId, volumeName: updated.name });
	}

	return { volume };
};

const updateVolume = async (shortId: ShortId, data: UpdateVolumeBody, signal?: AbortSignal) => {
	const existing = await findVolume(shortId);
	if (!existing) throw new NotFoundError("Volume not found");

	const name = normalizeRequiredName(data.name ?? existing.name);
	if (name === null) throw new BadRequestError("Volume name cannot be empty");

	return existing.sourceKind === "filesystem"
		? updateFilesystemVolume(existing, { ...data, name }, signal)
		: updateManagedVolume(existing, { ...data, name });
};

const testConnection = (backendConfig: BackendConfig) => Effect.runPromise(testVolumeConnection(backendConfig));

const DEFAULT_PAGE_SIZE = 500;

const listFiles = async (
	shortId: ShortId,
	subPath?: string,
	offset: number = 0,
	limit: number = DEFAULT_PAGE_SIZE,
	signal?: AbortSignal,
) => {
	const volume = await findVolume(shortId);

	if (!volume) {
		throw new NotFoundError("Volume not found");
	}

	if (volume.sourceKind === "managed" && volume.status !== "mounted") {
		throw new InternalServerError("Volume is not mounted");
	}

	const command = await runEffectPromise(
		runFilesystemCommand(volume.agentId, getOrganizationId(), {
			name: "filesystem.listFiles",
			source: assembleVolumeExecutionSource(volume),
			subPath,
			offset,
			limit,
		}),
		{ signal },
	);

	return command.result;
};

const browseFilesystem = async (agentId: string, rootId: string, browsePath: string, signal?: AbortSignal) => {
	const organizationId = getOrganizationId();

	await validateTrustedRoot(agentId, rootId, organizationId);

	const relativePath = normalizeRelativePath(browsePath);
	const reference = { rootId, relativePath };

	const command = await runEffectPromise(
		runFilesystemCommand(agentId, organizationId, { name: "filesystem.browse", source: reference }),
		{ signal },
	);

	return command.result;
};

const listSourceMachines = async () => {
	const organizationId = getOrganizationId();
	return querySourceMachines(organizationId);
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
	listSourceMachines,
	validateTrustedRoot,
};
