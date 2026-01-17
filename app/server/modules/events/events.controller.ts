import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { logger } from "../../utils/logger";
import { serverEvents } from "../../core/events";
import { requireAuth } from "../auth/auth.middleware";
import type { DoctorResult } from "~/schemas/restic";

export const eventsController = new Hono().use(requireAuth).get("/", (c) => {
	logger.info("Client connected to SSE endpoint");

	return streamSSE(c, async (stream) => {
		await stream.writeSSE({
			data: JSON.stringify({ type: "connected", timestamp: Date.now() }),
			event: "connected",
		});

		const onBackupStarted = async (data: { scheduleId: number; volumeName: string; repositoryName: string }) => {
			await stream.writeSSE({
				data: JSON.stringify(data),
				event: "backup:started",
			});
		};

		const onBackupProgress = async (data: {
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
			await stream.writeSSE({
				data: JSON.stringify(data),
				event: "backup:progress",
			});
		};

		const onBackupCompleted = async (data: {
			scheduleId: number;
			volumeName: string;
			repositoryName: string;
			status: "success" | "error" | "stopped" | "warning";
		}) => {
			await stream.writeSSE({
				data: JSON.stringify(data),
				event: "backup:completed",
			});
		};

		const onVolumeMounted = async (data: { volumeName: string }) => {
			await stream.writeSSE({
				data: JSON.stringify(data),
				event: "volume:mounted",
			});
		};

		const onVolumeUnmounted = async (data: { volumeName: string }) => {
			await stream.writeSSE({
				data: JSON.stringify(data),
				event: "volume:unmounted",
			});
		};

		const onVolumeUpdated = async (data: { volumeName: string }) => {
			await stream.writeSSE({
				data: JSON.stringify(data),
				event: "volume:updated",
			});
		};

		const onMirrorStarted = async (data: { scheduleId: number; repositoryId: string; repositoryName: string }) => {
			await stream.writeSSE({
				data: JSON.stringify(data),
				event: "mirror:started",
			});
		};

		const onMirrorCompleted = async (data: {
			scheduleId: number;
			repositoryId: string;
			repositoryName: string;
			status: "success" | "error";
			error?: string;
		}) => {
			await stream.writeSSE({
				data: JSON.stringify(data),
				event: "mirror:completed",
			});
		};

		const onDoctorStarted = async (data: { repositoryId: string; repositoryName: string }) => {
			await stream.writeSSE({
				data: JSON.stringify(data),
				event: "doctor:started",
			});
		};

		const onDoctorCompleted = async (
			data: {
				repositoryId: string;
				repositoryName: string;
			} & DoctorResult,
		) => {
			await stream.writeSSE({
				data: JSON.stringify(data),
				event: "doctor:completed",
			});
		};

		const onDoctorCancelled = async (data: { repositoryId: string; repositoryName: string; error?: string }) => {
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
		serverEvents.on("doctor:started", onDoctorStarted);
		serverEvents.on("doctor:completed", onDoctorCompleted);
		serverEvents.on("doctor:cancelled", onDoctorCancelled);

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
			serverEvents.off("doctor:started", onDoctorStarted);
			serverEvents.off("doctor:completed", onDoctorCompleted);
			serverEvents.off("doctor:cancelled", onDoctorCancelled);
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
