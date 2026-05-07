import { and, eq } from "drizzle-orm";
import { BadRequestError, InternalServerError, NotFoundError } from "http-errors-enhanced";
import { db } from "../../db/db";
import { volumesTable } from "../../db/schema";
import { toMessage } from "../../utils/errors";
import { generateShortId } from "../../utils/id";
import type { StatFs } from "../../utils/mountinfo";
import { withTimeout } from "../../utils/timeout";
import { config } from "../../core/config";
import { LOCAL_AGENT_ID } from "../agents/constants";
import { agentManager } from "../agents/agents-manager";
import type { UpdateVolumeBody } from "./volume.dto";
import { logger } from "@zerobyte/core/node";
import { serverEvents } from "../../core/events";
import type { Volume } from "../../db/schema";
import { volumeConfigSchema, type BackendConfig } from "~/schemas/volumes";
import { getOrganizationId } from "~/server/core/request-context";
import { type ShortId } from "~/server/utils/branded";
import { decryptVolumeConfig, encryptVolumeConfig } from "./volume-config-secrets";
import type { VolumeCommand, VolumeCommandResult } from "@zerobyte/contracts/agent-protocol";
import { createVolumeBackend, getStatFs, getVolumePath } from "../../../../apps/agent/src/volume-host";
import {
	browseFilesystem as browseHostFilesystem,
	listVolumeFiles,
	testVolumeConnection,
} from "../../../../apps/agent/src/volume-host/operations";
import { Effect } from "effect";

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

const runVolumeCommand = async <TCommand extends VolumeCommand>(agentId: string, command: TCommand) => {
	const result = await agentManager.runVolumeCommand(agentId, command);
	if (result.name !== command.name) {
		throw new InternalServerError(`Unexpected agent response for ${command.name}`);
	}

	return result as Extract<VolumeCommandResult, { name: TCommand["name"] }>;
};

const volumeForAgent = async (volume: Volume): Promise<Volume> => ({
	...volume,
	config: await decryptVolumeConfig(volume.config),
});

const volumeForHost = async (volume: Volume): Promise<Volume> => ({
	...volume,
	shortId: volume.shortId,
	config: await decryptVolumeConfig(volume.config),
	provisioningId: volume.provisioningId ?? null,
});

// TODO(agent-rollout): Remove the local host execution branch once all installs run volume operations through agents.
const shouldRunViaAgent = (volume: Volume) => volume.agentId !== LOCAL_AGENT_ID || config.flags.enableLocalAgent;

const runVolumeBackendCommand = async (
	volume: Volume,
	name: "volume.mount" | "volume.unmount" | "volume.checkHealth",
) => {
	if (!shouldRunViaAgent(volume)) {
		const backend = createVolumeBackend(await volumeForHost(volume));
		switch (name) {
			case "volume.mount":
				return backend.mount();
			case "volume.unmount":
				return backend.unmount();
			case "volume.checkHealth":
				return backend.checkHealth();
		}
	}

	const command = await runVolumeCommand(volume.agentId, {
		name,
		volume: await volumeForAgent(volume),
	});
	return command.result;
};

const createVolume = async (name: string, backendConfig: BackendConfig) => {
	const organizationId = getOrganizationId();
	const trimmedName = name.trim();

	if (trimmedName.length === 0) {
		throw new BadRequestError("Volume name cannot be empty");
	}

	const shortId = generateShortId();
	const encryptedConfig = await encryptVolumeConfig(backendConfig);

	const [created] = await db
		.insert(volumesTable)
		.values({
			shortId,
			name: trimmedName,
			config: encryptedConfig,
			type: backendConfig.backend,
			agentId: LOCAL_AGENT_ID,
			organizationId,
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

	await runVolumeBackendCommand(volume, "volume.unmount");
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

const unmountVolume = async (shortId: ShortId) => {
	const organizationId = getOrganizationId();
	const volume = await findVolume(shortId);

	if (!volume) {
		throw new NotFoundError("Volume not found");
	}

	const { status, error } = await runVolumeBackendCommand(volume, "volume.unmount");

	await db
		.update(volumesTable)
		.set({ status })
		.where(and(eq(volumesTable.id, volume.id), eq(volumesTable.organizationId, organizationId)));

	if (status === "unmounted") {
		serverEvents.emit("volume:unmounted", { organizationId, volumeName: volume.name });
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
		statfs = await withTimeout(
			shouldRunViaAgent(volume)
				? runVolumeCommand(volume.agentId, {
						name: "volume.statfs",
						volume: await volumeForAgent(volume),
					}).then((command) => command.result)
				: volumeForHost(volume).then((hostVolume) => getStatFs(getVolumePath(hostVolume))),
			1000,
			"volume.statfs",
		).catch((error) => {
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

	const newName = volumeData.name !== undefined ? volumeData.name.trim() : existing.name;

	if (newName.length === 0) {
		throw new BadRequestError("Volume name cannot be empty");
	}

	const configChanged =
		JSON.stringify(existing.config) !== JSON.stringify(volumeData.config) && volumeData.config !== undefined;

	if (configChanged) {
		logger.debug("Unmounting existing volume before applying new config");
		await runVolumeBackendCommand(existing, "volume.unmount");
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
	if (!config.flags.enableLocalAgent) {
		return Effect.runPromise(testVolumeConnection(backendConfig));
	}

	const command = await runVolumeCommand(LOCAL_AGENT_ID, { name: "volume.testConnection", backendConfig });
	return command.result;
};

const checkHealth = async (shortId: ShortId) => {
	const organizationId = getOrganizationId();
	const volume = await findVolume(shortId);

	if (!volume) {
		throw new NotFoundError("Volume not found");
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

	if (volume.status !== "mounted") {
		throw new InternalServerError("Volume is not mounted");
	}

	try {
		if (!shouldRunViaAgent(volume)) {
			return await listVolumeFiles(await volumeForHost(volume), subPath, offset, limit);
		}

		const command = await runVolumeCommand(volume.agentId, {
			name: "volume.listFiles",
			volume: await volumeForAgent(volume),
			subPath,
			offset,
			limit,
		});
		return command.result;
	} catch (error) {
		throw new InternalServerError(`Failed to list files: ${toMessage(error)}`);
	}
};

const browseFilesystem = async (browsePath: string) => {
	try {
		if (!config.flags.enableLocalAgent) {
			return await browseHostFilesystem(browsePath);
		}

		const command = await runVolumeCommand(LOCAL_AGENT_ID, { name: "filesystem.browse", path: browsePath });
		return command.result;
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
