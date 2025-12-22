import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { logger } from "../../utils/logger";
import { serverEvents } from "../../core/events";
import { requireAuth } from "../auth/auth.middleware";

export const eventsController = new Hono().use(requireAuth).get("/", (c) => {
	logger.info("Client connected to SSE endpoint");

	return streamSSE(c, async (stream) => {
		await stream.writeSSE({
			data: JSON.stringify({ type: "connected", timestamp: Date.now() }),
			event: "connected",
		});

		const onBackupStarted = (data: { scheduleId: number; volumeName: string; repositoryName: string }) => {
			stream.writeSSE({
				data: JSON.stringify(data),
				event: "backup:started",
			});
		};

		const onBackupProgress = (data: {
			scheduleId: number;
			volumeName: string;
			repositoryName: string;
			seconds_elapsed: number;
			percent_done: number;
			total_files: number;
			files_done: number;
			total_bytes: number;
			bytes_done: number;
			current_files: string[];
		}) => {
			stream.writeSSE({
				data: JSON.stringify(data),
				event: "backup:progress",
			});
		};

		const onBackupCompleted = (data: {
			scheduleId: number;
			volumeName: string;
			repositoryName: string;
			status: "success" | "error" | "stopped" | "warning";
		}) => {
			stream.writeSSE({
				data: JSON.stringify(data),
				event: "backup:completed",
			});
		};

		const onVolumeMounted = (data: { volumeName: string }) => {
			stream.writeSSE({
				data: JSON.stringify(data),
				event: "volume:mounted",
			});
		};

		const onVolumeUnmounted = (data: { volumeName: string }) => {
			stream.writeSSE({
				data: JSON.stringify(data),
				event: "volume:unmounted",
			});
		};

		const onVolumeUpdated = (data: { volumeName: string }) => {
			stream.writeSSE({
				data: JSON.stringify(data),
				event: "volume:updated",
			});
		};

		const onMirrorStarted = (data: { scheduleId: number; repositoryId: string; repositoryName: string }) => {
			stream.writeSSE({
				data: JSON.stringify(data),
				event: "mirror:started",
			});
		};

		const onMirrorCompleted = (data: {
			scheduleId: number;
			repositoryId: string;
			repositoryName: string;
			status: "success" | "error";
			error?: string;
		}) => {
			stream.writeSSE({
				data: JSON.stringify(data),
				event: "mirror:completed",
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

		let keepAlive = true;

		stream.onAbort(() => {
			logger.info("Client disconnected from SSE endpoint");
			keepAlive = false;
			serverEvents.off("backup:started", onBackupStarted);
			serverEvents.off("backup:progress", onBackupProgress);
			serverEvents.off("backup:completed", onBackupCompleted);
			serverEvents.off("volume:mounted", onVolumeMounted);
			serverEvents.off("volume:unmounted", onVolumeUnmounted);
			serverEvents.off("volume:updated", onVolumeUpdated);
			serverEvents.off("mirror:started", onMirrorStarted);
			serverEvents.off("mirror:completed", onMirrorCompleted);
		});

		while (keepAlive) {
			await stream.writeSSE({
				data: JSON.stringify({ timestamp: Date.now() }),
				event: "heartbeat",
			});
			await stream.sleep(5000);
		}
	});
});
