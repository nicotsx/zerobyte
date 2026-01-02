import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import type {
	ServerBackupCompletedEventDto,
	ServerBackupProgressEventDto,
	ServerBackupStartedEventDto,
	ServerRestoreCompletedEventDto,
	ServerRestoreProgressEventDto,
	ServerRestoreStartedEventDto,
} from "~/schemas/events-dto";
import type { DoctorResult } from "~/schemas/restic";
import { serverEvents } from "../../core/events";
import { logger } from "../../utils/logger";
import { requireAuth } from "../auth/auth.middleware";

export const eventsController = new Hono().use(requireAuth).get("/", (c) => {
	logger.info("Client connected to SSE endpoint");
	const organizationId = c.get("organizationId");

	return streamSSE(c, async (stream) => {
		await stream.writeSSE({
			data: JSON.stringify({ type: "connected", timestamp: Date.now() }),
			event: "connected",
		});

		const onBackupStarted = async (data: ServerBackupStartedEventDto) => {
			if (data.organizationId !== organizationId) return;
			await stream.writeSSE({
				data: JSON.stringify(data),
				event: "backup:started",
			});
		};

		const onBackupProgress = async (data: ServerBackupProgressEventDto) => {
			if (data.organizationId !== organizationId) return;
			await stream.writeSSE({
				data: JSON.stringify(data),
				event: "backup:progress",
			});
		};

		const onBackupCompleted = async (data: ServerBackupCompletedEventDto) => {
			if (data.organizationId !== organizationId) return;
			await stream.writeSSE({
				data: JSON.stringify(data),
				event: "backup:completed",
			});
		};

		const onVolumeMounted = async (data: { organizationId: string; volumeName: string }) => {
			if (data.organizationId !== organizationId) return;
			await stream.writeSSE({
				data: JSON.stringify(data),
				event: "volume:mounted",
			});
		};

		const onVolumeUnmounted = async (data: { organizationId: string; volumeName: string }) => {
			if (data.organizationId !== organizationId) return;
			await stream.writeSSE({
				data: JSON.stringify(data),
				event: "volume:unmounted",
			});
		};

		const onVolumeUpdated = async (data: { organizationId: string; volumeName: string }) => {
			if (data.organizationId !== organizationId) return;
			await stream.writeSSE({
				data: JSON.stringify(data),
				event: "volume:updated",
			});
		};

		const onMirrorStarted = async (data: {
			organizationId: string;
			scheduleId: number;
			repositoryId: string;
			repositoryName: string;
		}) => {
			if (data.organizationId !== organizationId) return;
			await stream.writeSSE({
				data: JSON.stringify(data),
				event: "mirror:started",
			});
		};

		const onMirrorCompleted = async (data: {
			organizationId: string;
			scheduleId: number;
			repositoryId: string;
			repositoryName: string;
			status: "success" | "error";
			error?: string;
		}) => {
			if (data.organizationId !== organizationId) return;
			await stream.writeSSE({
				data: JSON.stringify(data),
				event: "mirror:completed",
			});
		};

		const onRestoreStarted = async (data: ServerRestoreStartedEventDto) => {
			if (data.organizationId !== organizationId) return;
			await stream.writeSSE({
				data: JSON.stringify(data),
				event: "restore:started",
			});
		};

		const onRestoreProgress = async (data: ServerRestoreProgressEventDto) => {
			if (data.organizationId !== organizationId) return;
			await stream.writeSSE({
				data: JSON.stringify(data),
				event: "restore:progress",
			});
		};

		const onRestoreCompleted = async (data: ServerRestoreCompletedEventDto) => {
			if (data.organizationId !== organizationId) return;
			await stream.writeSSE({
				data: JSON.stringify(data),
				event: "restore:completed",
			});
		};

		const onDoctorStarted = async (data: { organizationId: string; repositoryId: string; repositoryName: string }) => {
			if (data.organizationId !== organizationId) return;
			await stream.writeSSE({
				data: JSON.stringify(data),
				event: "doctor:started",
			});
		};

		const onDoctorCompleted = async (
			data: {
				organizationId: string;
				repositoryId: string;
				repositoryName: string;
			} & DoctorResult,
		) => {
			if (data.organizationId !== organizationId) return;
			await stream.writeSSE({
				data: JSON.stringify(data),
				event: "doctor:completed",
			});
		};

		const onDoctorCancelled = async (data: {
			organizationId: string;
			repositoryId: string;
			repositoryName: string;
			error?: string;
		}) => {
			if (data.organizationId !== organizationId) return;
			await stream.writeSSE({
				data: JSON.stringify(data),
				event: "doctor:cancelled",
			});
		};

		serverEvents.on("backup:started", onBackupStarted);
		serverEvents.on("backup:progress", onBackupProgress);
		serverEvents.on("backup:completed", onBackupCompleted);
		serverEvents.on("volume:mounted", onVolumeMounted);
		serverEvents.on("volume:unmounted", onVolumeUnmounted);
		serverEvents.on("volume:updated", onVolumeUpdated);
		serverEvents.on("mirror:started", onMirrorStarted);
		serverEvents.on("mirror:completed", onMirrorCompleted);
		serverEvents.on("restore:started", onRestoreStarted);
		serverEvents.on("restore:progress", onRestoreProgress);
		serverEvents.on("restore:completed", onRestoreCompleted);
		serverEvents.on("doctor:started", onDoctorStarted);
		serverEvents.on("doctor:completed", onDoctorCompleted);
		serverEvents.on("doctor:cancelled", onDoctorCancelled);

		let keepAlive = true;
		let cleanedUp = false;

		function cleanup() {
			if (cleanedUp) return;
			cleanedUp = true;

			c.req.raw.signal.removeEventListener("abort", onRequestAbort);
			serverEvents.off("backup:started", onBackupStarted);
			serverEvents.off("backup:progress", onBackupProgress);
			serverEvents.off("backup:completed", onBackupCompleted);
			serverEvents.off("volume:mounted", onVolumeMounted);
			serverEvents.off("volume:unmounted", onVolumeUnmounted);
			serverEvents.off("volume:updated", onVolumeUpdated);
			serverEvents.off("mirror:started", onMirrorStarted);
			serverEvents.off("mirror:completed", onMirrorCompleted);
			serverEvents.off("restore:started", onRestoreStarted);
			serverEvents.off("restore:progress", onRestoreProgress);
			serverEvents.off("restore:completed", onRestoreCompleted);
			serverEvents.off("doctor:started", onDoctorStarted);
			serverEvents.off("doctor:completed", onDoctorCompleted);
			serverEvents.off("doctor:cancelled", onDoctorCancelled);
		}

		function handleDisconnect() {
			if (!keepAlive) return;
			logger.info("Client disconnected from SSE endpoint");
			keepAlive = false;
			cleanup();
		}

		function onRequestAbort() {
			handleDisconnect();
			stream.abort();
		}

		stream.onAbort(handleDisconnect);
		c.req.raw.signal.addEventListener("abort", onRequestAbort, { once: true });

		try {
			while (keepAlive && !c.req.raw.signal.aborted && !stream.aborted) {
				await stream.writeSSE({
					data: JSON.stringify({ timestamp: Date.now() }),
					event: "heartbeat",
				});
				await stream.sleep(5000);
			}
		} finally {
			cleanup();
		}
	});
});
