import { and, eq } from "drizzle-orm";
import { BadRequestError, NotFoundError } from "http-errors-enhanced";
import { logger } from "@zerobyte/core/node";
import { db } from "../../db/db";
import { volumesTable, type Volume } from "../../db/schema";
import { getOrganizationId } from "../../core/request-context";
import { serverEvents } from "../../core/events";
import { runEffectPromise, toMessage } from "../../utils/errors";
import type { ShortId } from "../../utils/branded";
import { Effect, Either } from "effect";
import { LOCAL_AGENT_ID } from "../agents/constants";
import { createVolumeBackend } from "./volume-host";
import { decryptVolumeConfig } from "./volume-config-secrets";
import { assembleVolumeExecutionSource, probeSource } from "./volume-execution-source";
import { findVolume } from "./volume-queries";

type EnsureHealthyVolumeResult = { ready: true; remounted: boolean } | { ready: false; reason: string };

export const runVolumeBackendOperation = async (volume: Volume, operation: "mount" | "unmount" | "checkHealth") => {
	if (volume.sourceKind !== "managed")
		throw new BadRequestError("Trusted filesystem sources do not support mount operations");
	if (volume.agentId !== LOCAL_AGENT_ID)
		throw new BadRequestError("Managed volume backends are owned by the controller");

	const config = await decryptVolumeConfig(volume.config);
	return createVolumeBackend({ ...volume, config })[operation]();
};

const mountLoadedVolume = async (volume: Volume, signal?: AbortSignal) => {
	signal?.throwIfAborted();

	const organizationId = getOrganizationId();

	if (volume.type === "directory") {
		return checkVolumeHealth(volume, signal);
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

const mountVolume = async (shortId: ShortId, signal?: AbortSignal) => {
	const volume = await findVolume(shortId);
	if (!volume) throw new NotFoundError("Volume not found");

	return mountLoadedVolume(volume, signal);
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

const checkVolumeHealth = async (volume: Volume, signal?: AbortSignal) => {
	signal?.throwIfAborted();

	const organizationId = getOrganizationId();

	if (volume.sourceKind === "filesystem") {
		const result = await runEffectPromise(
			probeSource(volume.agentId, organizationId, assembleVolumeExecutionSource(volume)).pipe(Effect.either),
			{ signal },
		);
		const error = Either.isLeft(result) ? toMessage(result.left) : undefined;
		const status = error ? "error" : "mounted";

		await db
			.update(volumesTable)
			.set({ lastHealthCheck: Date.now(), status, lastError: error ?? null })
			.where(and(eq(volumesTable.id, volume.id), eq(volumesTable.organizationId, organizationId)));

		return { status, error };
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

const checkHealth = async (shortId: ShortId, signal?: AbortSignal) => {
	const volume = await findVolume(shortId);
	if (!volume) throw new NotFoundError("Volume not found");

	return checkVolumeHealth(volume, signal);
};

const ensureHealthyVolume = async (volume: Volume, signal?: AbortSignal): Promise<EnsureHealthyVolumeResult> => {
	signal?.throwIfAborted();

	if (volume.sourceKind === "filesystem" || volume.type === "directory") {
		const health = await checkVolumeHealth(volume, signal);
		signal?.throwIfAborted();
		if (health.status === "mounted") {
			return { ready: true, remounted: false };
		}
		return { ready: false, reason: health.error ?? "Volume is unavailable" };
	}

	if (volume.status === "unmounted") {
		return { ready: false, reason: volume.lastError ?? "Volume is not mounted" };
	}

	let failureReason = volume.lastError ?? "Volume health check failed";

	if (volume.status !== "error") {
		const health = await checkVolumeHealth(volume, signal);
		signal?.throwIfAborted();

		if (health.status === "mounted") {
			return { ready: true, remounted: false };
		}

		failureReason = health.error ?? failureReason;
	}

	if (!volume.autoRemount) {
		return { ready: false, reason: failureReason };
	}

	logger.warn(
		`${volume.name} is not healthy. Auto-remount is enabled, attempting to remount. Reason: ${failureReason}`,
	);
	signal?.throwIfAborted();
	const remount = await mountLoadedVolume(volume, signal);

	if (remount.status !== "mounted") {
		return {
			ready: false,
			reason: remount.error ?? failureReason,
		};
	}

	return { ready: true, remounted: true };
};

export const volumeLifecycle = { mountVolume, unmountVolume, checkHealth, ensureHealthyVolume };
