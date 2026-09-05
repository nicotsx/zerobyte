import { and, eq } from "drizzle-orm";
import { BadRequestError, InternalServerError, NotFoundError, ServiceUnavailableError } from "http-errors-enhanced";
import { db } from "../../db/db";
import { volumesTable } from "../../db/schema";
import { toMessage } from "../../utils/errors";
import { generateShortId } from "../../utils/id";
import type { StatFs } from "../../utils/mountinfo";
import { withTimeout } from "../../utils/timeout";
import { LOCAL_AGENT_ID } from "../agents/constants";
import { agentManager } from "../agents/agents-manager";
import type { CreateVolumeBody, UpdateVolumeBody } from "./volume.dto";
import { logger } from "@zerobyte/core/node";
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
import type { VolumeCommand, VolumeCommandResult } from "@zerobyte/contracts/agent-protocol";
import {
	assembleTrustedFilesystemExecutionSource,
	assembleVolumeExecutionSource,
	toCanonicalVolume,
	validateTrustedRoot,
} from "./volume-execution-source";
import { listSourceMachines as querySourceMachines } from "./source-discovery";
import { getVolumePath } from "./helpers";
import { presentVolumes } from "./volume-presentation";

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

const runVolumeCommand = async <TCommand extends VolumeCommand>(
	agentId: string,
	organizationId: string,
	command: TCommand,
) => {
	const result = await agentManager.runVolumeCommand(agentId, organizationId, command);
	if (result.name !== command.name) {
		throw new InternalServerError(`Unexpected agent response for ${command.name}`);
	}

	return result as Extract<VolumeCommandResult, { name: TCommand["name"] }>;
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
		await runVolumeCommand(agentId, organizationId, { name: "volume.statfs", source });
	} catch (error) {
		throw new ServiceUnavailableError(`Filesystem source is unavailable: ${toMessage(error)}`);
	}
};

const runVolumeBackendCommand = async (
	volume: Volume,
	name: "volume.mount" | "volume.unmount" | "volume.checkHealth",
) => {
	if (volume.sourceKind === "agent-filesystem") {
		throw new BadRequestError("Trusted filesystem sources do not support mount operations");
	}
	if (volume.agentId !== LOCAL_AGENT_ID) {
		throw new BadRequestError("Managed volume backends can only run on the built-in local agent");
	}
	const organizationId = getOrganizationId();
	const source = await assembleVolumeExecutionSource(volume, organizationId);
	if (source.kind !== "managed") {
		throw new InternalServerError("Managed volume execution source was expected");
	}
	const command = await runVolumeCommand(volume.agentId, organizationId, {
		name,
		volume: source.volume,
	});
	if (command.name !== "volume.mount" && command.name !== "volume.unmount" && command.name !== "volume.checkHealth") {
		throw new InternalServerError(`Unexpected agent response for ${name}`);
	}
	return command.result;
};

const createVolume = async (body: CreateVolumeBody) => {
	const organizationId = getOrganizationId();
	const normalizedName = normalizeRequiredName(body.name);

	if (normalizedName === null) {
		throw new BadRequestError("Volume name cannot be empty");
	}

	const shortId = generateShortId();
	if (body.sourceKind === "agent-filesystem") {
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
				sourceKind: "agent-filesystem",
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

	const { error, status } = await runVolumeBackendCommand(created, "volume.mount");

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

	if (volume.sourceKind !== "agent-filesystem") {
		await runVolumeBackendCommand(volume, "volume.unmount");
	}
	await db
		.delete(volumesTable)
		.where(and(eq(volumesTable.id, volume.id), eq(volumesTable.organizationId, organizationId)));
};

const mountVolume = async (shortId: ShortId) => {
	const organizationId = getOrganizationId();
	const volume = await findVolume(shortId);

	if (!volume) {
		throw new NotFoundError("Volume not found");
	}

	if (volume.type === "directory") {
		return checkHealth(shortId);
	}

	await runVolumeBackendCommand(volume, "volume.unmount");
	const { error, status } = await runVolumeBackendCommand(volume, "volume.mount");

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

	const { status, error } = await runVolumeBackendCommand(volume, "volume.unmount");

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

const getCanonicalVolumeDetail = async (shortId: ShortId) => {
	const volume = await findVolume(shortId);

	if (!volume) {
		throw new NotFoundError("Volume not found");
	}

	let statfs: Partial<StatFs> = {};
	if (volume.sourceKind === "managed" && volume.status === "mounted") {
		const organizationId = getOrganizationId();
		const source = await assembleVolumeExecutionSource(volume, organizationId);
		const statfsCommand = async () => {
			const command = await runVolumeCommand(volume.agentId, organizationId, {
				name: "volume.statfs",
				source,
			});
			return command.result;
		};
		const statfsResult = statfsCommand();
		statfs = await withTimeout(statfsResult, 1000, "volume.statfs").catch((error) => {
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
	if (volume.sourceKind === "agent-filesystem") {
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
		existingVolume.sourceKind === "agent-filesystem"
			? "Failed to update filesystem source"
			: "Failed to update volume";
	let updateValues: Partial<typeof volumesTable.$inferInsert>;
	let configChanged = false;

	if (existingVolume.sourceKind === "agent-filesystem") {
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
			await runVolumeBackendCommand(existing, "volume.unmount");
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
		const { error, status } = await runVolumeBackendCommand(updated, "volume.mount");
		await db
			.update(volumesTable)
			.set({ status, lastError: error ?? null, lastHealthCheck: Date.now() })
			.where(and(eq(volumesTable.id, existing.id), eq(volumesTable.organizationId, organizationId)));

		serverEvents.emit("volume:updated", { organizationId, volumeName: updated.name });
	}

	return { volume: updated };
};

const testConnection = async (backendConfig: BackendConfig) => {
	const organizationId = getOrganizationId();
	const command = await agentManager.runVolumeCommand(LOCAL_AGENT_ID, organizationId, {
		name: "volume.testConnection",
		backendConfig,
	});
	if (command.name !== "volume.testConnection") {
		throw new InternalServerError("Unexpected agent response for volume.testConnection");
	}
	return command.result;
};

const checkHealth = async (shortId: ShortId) => {
	const organizationId = getOrganizationId();
	const volume = await findVolume(shortId);

	if (!volume) {
		throw new NotFoundError("Volume not found");
	}
	if (volume.sourceKind === "agent-filesystem") {
		const checkedAt = Date.now();
		try {
			const source = await assembleVolumeExecutionSource(volume, organizationId);
			await runVolumeCommand(volume.agentId, organizationId, { name: "volume.statfs", source });
			await db
				.update(volumesTable)
				.set({ lastHealthCheck: checkedAt, status: "mounted", lastError: null })
				.where(and(eq(volumesTable.id, volume.id), eq(volumesTable.organizationId, organizationId)));
			return { status: "mounted" as const, error: undefined };
		} catch (error) {
			const message = toMessage(error);
			await db
				.update(volumesTable)
				.set({ lastHealthCheck: checkedAt, status: "error", lastError: message })
				.where(and(eq(volumesTable.id, volume.id), eq(volumesTable.organizationId, organizationId)));
			return { status: "error" as const, error: message };
		}
	}

	const { error, status } = await runVolumeBackendCommand(volume, "volume.checkHealth");

	if (status !== volume.status) {
		serverEvents.emit("volume:status_changed", { organizationId, volumeName: volume.name, status });
	}

	await db
		.update(volumesTable)
		.set({ lastHealthCheck: Date.now(), status, lastError: error ?? null })
		.where(and(eq(volumesTable.id, volume.id), eq(volumesTable.organizationId, organizationId)));

	return { status, error };
};

const ensureHealthyVolume = async (shortId: ShortId): Promise<EnsureHealthyVolumeResult> => {
	const volume = await findVolume(shortId);

	if (!volume) {
		throw new NotFoundError("Volume not found");
	}
	if (volume.sourceKind === "agent-filesystem") {
		const health = await checkHealth(shortId);
		if (health.status === "mounted") {
			const healthyVolume = { ...volume, status: "mounted" as const, lastError: null };
			return { ready: true, volume: healthyVolume, remounted: false };
		}
		const reason = health.error ?? "Trusted filesystem source is unavailable";
		const failedVolume = { ...volume, status: "error" as const, lastError: reason };
		return { ready: false, volume: failedVolume, reason };
	}

	if (volume.type === "directory") {
		const health = await checkHealth(shortId);
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
	const remount = await mountVolume(shortId);

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

	if (volume.sourceKind === "managed" && volume.status !== "mounted") {
		throw new InternalServerError("Volume is not mounted");
	}

	try {
		const organizationId = getOrganizationId();
		const source = await assembleVolumeExecutionSource(volume, organizationId);
		const command = await runVolumeCommand(volume.agentId, organizationId, {
			name: "volume.listFiles",
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
		const command = await runVolumeCommand(agentId, organizationId, { name: "filesystem.browse", reference });
		return command.result;
	} catch (error) {
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
