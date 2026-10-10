import { and, eq } from "drizzle-orm";
import { BadRequestError, InternalServerError, NotFoundError, ServiceUnavailableError } from "http-errors-enhanced";
import { db } from "../../db/db";
import { volumesTable } from "../../db/schema";
import { toMessage } from "../../utils/errors";
import { generateShortId } from "../../utils/id";
import type { StatFs } from "@zerobyte/core/filesystem";
import { withTimeout } from "../../utils/timeout";
import { LOCAL_AGENT_ID } from "../agents/constants";
import { testVolumeConnection } from "./volume-host/operations";
import { Effect } from "effect";
import { agentManager } from "../agents/agents-manager";
import type { CreateVolumeBody, UpdateVolumeBody } from "./volume.dto";
import { logger } from "@zerobyte/core/node";
import { findVolume } from "./volume-queries";
import { volumeLifecycle, runVolumeBackendOperation } from "./volume-lifecycle";
import { serverEvents } from "../../core/events";
import type { Volume } from "../../db/schema";
import {
	normalizeTrustedSourceRelativePath,
	presentedVolumeDetailSchema,
	volumeConfigSchema,
	type BackendConfig,
	type Volume as CanonicalVolume,
} from "@zerobyte/contracts/volumes";
import { getOrganizationId } from "~/server/core/request-context";
import { type ShortId } from "~/server/utils/branded";
import { normalizeRequiredName } from "~/server/utils/names";
import { encryptVolumeConfig } from "./volume-config-secrets";
import type { FilesystemCommand, FilesystemCommandResult } from "@zerobyte/contracts/agent-protocol";
import {
	assembleTrustedFilesystemExecutionSource,
	assembleVolumeExecutionSource,
	toCanonicalVolume,
	validateTrustedRoot,
} from "./volume-execution-source";
import { listSourceMachines as querySourceMachines } from "./source-discovery";
import { getVolumePath } from "./helpers";
import { presentVolumes } from "./volume-presentation";

const { mountVolume, unmountVolume, checkHealth, ensureHealthyVolume } = volumeLifecycle;

const listVolumes = async () => {
	const organizationId = getOrganizationId();
	const volumes = await db.query.volumesTable.findMany({
		where: { organizationId: organizationId },
		orderBy: { id: "asc" },
	});

	return volumes;
};

const runFilesystemCommand = async <TCommand extends FilesystemCommand>(
	agentId: string,
	organizationId: string,
	command: TCommand,
) => {
	const result = await agentManager.runFilesystemCommand(agentId, organizationId, command);
	if (result.name !== command.name) {
		throw new InternalServerError(`Unexpected agent response for ${command.name}`);
	}

	return result as Extract<FilesystemCommandResult, { name: TCommand["name"] }>;
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
) => {
	const source = await assembleTrustedFilesystemExecutionSource(agentId, trustedRootId, relativePath, organizationId);
	try {
		await runFilesystemCommand(agentId, organizationId, { name: "filesystem.statfs", source });
	} catch (error) {
		throw new ServiceUnavailableError(`Filesystem source is unavailable: ${toMessage(error)}`);
	}
};

const createVolume = async (body: CreateVolumeBody) => {
	const organizationId = getOrganizationId();
	const normalizedName = normalizeRequiredName(body.name);

	if (normalizedName === null) {
		throw new BadRequestError("Volume name cannot be empty");
	}

	const shortId = generateShortId();
	if (body.sourceKind === "filesystem") {
		const relativePath = normalizeRelativePath(body.relativePath);
		await preflightTrustedFilesystemSource(body.agentId, body.trustedRootId, relativePath, organizationId);
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
		return { volume: created, status: 201 };
	}

	const agentId = body.agentId ?? LOCAL_AGENT_ID;
	if (agentId !== LOCAL_AGENT_ID) {
		throw new BadRequestError("Managed volume backends can only target the built-in local agent");
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

	if (volume.sourceKind !== "filesystem") {
		await runVolumeBackendOperation(volume, "unmount");
	}
	await db
		.delete(volumesTable)
		.where(and(eq(volumesTable.id, volume.id), eq(volumesTable.organizationId, organizationId)));
};

const getCanonicalVolumeDetail = async (shortId: ShortId) => {
	const volume = await findVolume(shortId);

	if (!volume) {
		throw new NotFoundError("Volume not found");
	}

	let statfs: Partial<StatFs> = {};
	if (volume.sourceKind === "managed" && volume.status === "mounted") {
		const organizationId = getOrganizationId();
		const statfsResult = assembleVolumeExecutionSource(volume, organizationId).then(async (source) => {
			const command = await runFilesystemCommand(volume.agentId, organizationId, {
				name: "filesystem.statfs",
				source,
			});

			return command.result;
		});

		statfs = await withTimeout(statfsResult, 1000, "filesystem.statfs").catch((error) => {
			logger.warn(`Failed to get statfs for volume ${volume.name}: ${toMessage(error)}`);
			return {};
		});
	}

	return { volume, statfs };
};

const validateUpdateFieldsForSourceKind = (volume: CanonicalVolume, volumeData: UpdateVolumeBody) => {
	if (volumeData.sourceKind !== undefined && volumeData.sourceKind !== volume.sourceKind) {
		throw new BadRequestError("Volume source kind cannot be changed");
	}
	if (volume.sourceKind === "filesystem") {
		if (volumeData.config !== undefined || volumeData.autoRemount !== undefined) {
			throw new BadRequestError("Trusted filesystem sources cannot have managed backend fields");
		}
		return;
	}
	const hasTrustedFilesystemField =
		volumeData.agentId !== undefined ||
		volumeData.trustedRootId !== undefined ||
		volumeData.relativePath !== undefined;
	if (hasTrustedFilesystemField) {
		throw new BadRequestError("Managed volume backends cannot have trusted filesystem locations");
	}
};

const getUpdatedVolumeName = (existingName: string, name: UpdateVolumeBody["name"]) => {
	const updatedName = name === undefined ? existingName : normalizeRequiredName(name);
	if (updatedName === null) {
		throw new BadRequestError("Volume name cannot be empty");
	}
	return updatedName;
};

const updateVolume = async (shortId: ShortId, volumeData: UpdateVolumeBody) => {
	const organizationId = getOrganizationId();
	const existing = await findVolume(shortId);

	if (!existing) {
		throw new NotFoundError("Volume not found");
	}
	const existingVolume = toCanonicalVolume(existing);
	validateUpdateFieldsForSourceKind(existingVolume, volumeData);
	const name = getUpdatedVolumeName(existingVolume.name, volumeData.name);
	const updateErrorMessage =
		existingVolume.sourceKind === "filesystem" ? "Failed to update filesystem source" : "Failed to update volume";
	let updateValues: Partial<typeof volumesTable.$inferInsert>;
	let configChanged = false;

	if (existingVolume.sourceKind === "filesystem") {
		const agentChanged = volumeData.agentId !== undefined && volumeData.agentId !== existingVolume.agentId;
		const rootChanged =
			volumeData.trustedRootId !== undefined && volumeData.trustedRootId !== existingVolume.trustedRootId;
		if (agentChanged && volumeData.trustedRootId === undefined) {
			throw new BadRequestError("Changing the source machine requires a trusted root ID");
		}
		if ((agentChanged || rootChanged) && volumeData.relativePath === undefined) {
			throw new BadRequestError("Changing the source machine or root requires an explicit relative path");
		}
		const agentId = volumeData.agentId ?? existingVolume.agentId;
		const trustedRootId = volumeData.trustedRootId ?? existingVolume.trustedRootId;
		const rawRelativePath = volumeData.relativePath ?? existingVolume.relativePath;
		const relativePath = normalizeRelativePath(rawRelativePath);
		const pathChanged = volumeData.relativePath !== undefined && relativePath !== existingVolume.relativePath;
		const locationChanged = agentChanged || rootChanged || pathChanged;
		if (locationChanged) {
			await preflightTrustedFilesystemSource(agentId, trustedRootId, relativePath, organizationId);
		}
		const updatedAt = Date.now();
		updateValues = {
			name,
			agentId,
			trustedRootId,
			relativePath,
			updatedAt,
		};
		if (locationChanged) {
			updateValues.status = "mounted";
			updateValues.lastError = null;
			updateValues.lastHealthCheck = updatedAt;
		}
	} else {
		const configCandidate = volumeData.config ?? existingVolume.config;
		const parsedConfig = volumeConfigSchema.safeParse(configCandidate);
		if (!parsedConfig.success) {
			throw new BadRequestError("Invalid volume configuration");
		}
		const config = parsedConfig.data;
		configChanged =
			volumeData.config !== undefined && JSON.stringify(existingVolume.config) !== JSON.stringify(config);
		if (configChanged) {
			logger.debug("Unmounting existing volume before applying new config");
			await runVolumeBackendOperation(existing, "unmount");
		}
		const encryptedConfig = await encryptVolumeConfig(config);
		const autoRemount = volumeData.autoRemount ?? existingVolume.autoRemount;
		const updatedAt = Date.now();
		updateValues = {
			name,
			config: encryptedConfig,
			type: config.backend,
			autoRemount,
			updatedAt,
		};
	}

	const [updated] = await db
		.update(volumesTable)
		.set(updateValues)
		.where(and(eq(volumesTable.id, existing.id), eq(volumesTable.organizationId, organizationId)))
		.returning();

	if (!updated) {
		throw new InternalServerError(updateErrorMessage);
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

const testConnection = (backendConfig: BackendConfig) => Effect.runPromise(testVolumeConnection(backendConfig));

const DEFAULT_PAGE_SIZE = 500;

const listFiles = async (shortId: ShortId, subPath?: string, offset: number = 0, limit: number = DEFAULT_PAGE_SIZE) => {
	const volume = await findVolume(shortId);

	if (!volume) {
		throw new NotFoundError("Volume not found");
	}

	if (volume.sourceKind === "managed" && volume.status !== "mounted") {
		throw new InternalServerError("Volume is not mounted");
	}

	try {
		const organizationId = getOrganizationId();
		const source = await assembleVolumeExecutionSource(volume, organizationId);
		const command = await runFilesystemCommand(volume.agentId, organizationId, {
			name: "filesystem.listFiles",
			source,
			subPath,
			offset,
			limit,
		});

		return command.result;
	} catch (error) {
		throw new InternalServerError(`Failed to list files: ${toMessage(error)}`);
	}
};

const browseFilesystem = async (agentId: string, rootId: string, browsePath: string) => {
	const organizationId = getOrganizationId();

	await validateTrustedRoot(agentId, rootId, organizationId);

	const relativePath = normalizeRelativePath(browsePath);
	const reference = { rootId, relativePath };

	try {
		const command = await runFilesystemCommand(agentId, organizationId, {
			name: "filesystem.browse",
			source: reference,
		});

		return command.result;
	} catch (error) {
		if (error instanceof BadRequestError) throw error;
		throw new ServiceUnavailableError(`Failed to browse filesystem: ${toMessage(error)}`);
	}
};

const listSourceMachines = async () => {
	const organizationId = getOrganizationId();
	return querySourceMachines(organizationId);
};

const toPresentedVolume = async (volume: Volume) => {
	const [presented] = await presentVolumes([volume], getOrganizationId());
	if (!presented) throw new InternalServerError("Source presentation failed");
	return presented;
};

const toPresentedVolumeDetail = async (volume: Volume) => {
	const presentedVolume = await toPresentedVolume(volume);
	const path = getVolumePath(volume);
	const detail = { ...presentedVolume, path };
	return presentedVolumeDetailSchema.parse(detail);
};

const getVolume = async (shortId: ShortId) => {
	const result = await getCanonicalVolumeDetail(shortId);
	const volume = await toPresentedVolumeDetail(result.volume);
	return { ...result, volume };
};

const toPresentedVolumes = (volumes: Volume[]) => presentVolumes(volumes, getOrganizationId());

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
	toCanonicalVolume,
	toPresentedVolume,
	toPresentedVolumeDetail,
	toPresentedVolumes,
};
