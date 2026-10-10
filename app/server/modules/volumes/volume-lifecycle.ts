import { and, eq } from "drizzle-orm";
import { BadRequestError, NotFoundError } from "http-errors-enhanced";
import { logger } from "@zerobyte/core/node";
import { db } from "../../db/db";
import { volumesTable, type Volume } from "../../db/schema";
import { getOrganizationId } from "../../core/request-context";
import { serverEvents } from "../../core/events";
import { toMessage } from "../../utils/errors";
import type { ShortId } from "../../utils/branded";
import { agentManager } from "../agents/agents-manager";
import { LOCAL_AGENT_ID } from "../agents/constants";
import { createVolumeBackend } from "./volume-host";
import { decryptVolumeConfig } from "./volume-config-secrets";
import { assembleVolumeExecutionSource, toCanonicalVolume } from "./volume-execution-source";
import { findVolume } from "./volume-queries";

type EnsureHealthyVolumeResult =
	| { ready: true; volume: Volume; remounted: boolean }
	| { ready: false; volume: Volume; reason: string };

export const runVolumeBackendOperation = async (volume: Volume, operation: "mount" | "unmount" | "checkHealth") => {
	const canonical = toCanonicalVolume(volume);
	if (canonical.sourceKind !== "managed")
		throw new BadRequestError("Trusted filesystem sources do not support mount operations");
	if (canonical.agentId !== LOCAL_AGENT_ID)
		throw new BadRequestError("Managed volume backends are owned by the controller");

	const config = await decryptVolumeConfig(canonical.config);
	return createVolumeBackend({ ...canonical, config })[operation]();
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

const checkHealth = async (shortId: ShortId) => {
	const organizationId = getOrganizationId();
	const volume = await findVolume(shortId);

	if (!volume) {
		throw new NotFoundError("Volume not found");
	}
	if (volume.sourceKind === "filesystem") {
		const checkedAt = Date.now();
		try {
			const source = await assembleVolumeExecutionSource(volume, organizationId);
			await agentManager.runFilesystemCommand(volume.agentId, organizationId, {
				name: "filesystem.statfs",
				source,
			});
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
	if (volume.sourceKind === "filesystem") {
		const health = await checkHealth(shortId);
		signal?.throwIfAborted();
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

export const volumeLifecycle = { mountVolume, unmountVolume, checkHealth, ensureHealthyVolume };
