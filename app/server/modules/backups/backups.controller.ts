import { Hono } from "hono";
import { validator } from "hono-openapi";
import {
	createBackupScheduleBody,
	createBackupScheduleResponse,
	createBackupScheduleDto,
	deleteBackupScheduleDto,
	getBackupScheduleDto,
	getBackupScheduleResponse,
	getBackupScheduleForVolumeDto,
	getBackupScheduleForVolumeResponse,
	listBackupSchedulesDto,
	listBackupSchedulesResponse,
	runBackupNowDto,
	runForgetDto,
	stopBackupDto,
	updateBackupScheduleDto,
	updateBackupScheduleBody,
	updateBackupScheduleResponse,
	getScheduleMirrorsDto,
	updateScheduleMirrorsDto,
	updateScheduleMirrorsBody,
	getMirrorCompatibilityDto,
	getMirrorSyncStatusDto,
	reorderBackupSchedulesDto,
	reorderBackupSchedulesBody,
	getBackupProgressDto,
	syncMirrorBody,
	syncMirrorDto,
	type CreateBackupScheduleDto,
	type DeleteBackupScheduleDto,
	type GetBackupScheduleDto,
	type GetBackupScheduleForVolumeResponseDto,
	type ListBackupSchedulesResponseDto,
	type RunBackupNowDto,
	type RunForgetDto,
	type StopBackupDto,
	type UpdateBackupScheduleDto,
	type GetScheduleMirrorsDto,
	type UpdateScheduleMirrorsDto,
	type GetMirrorCompatibilityDto,
	type ReorderBackupSchedulesDto,
	type GetBackupProgressDto,
	type GetMirrorSyncStatusDto,
	type SyncMirrorDto,
} from "./backups.dto";
import { backupsService } from "./backups.service";
import {
	getScheduleNotificationsDto,
	updateScheduleNotificationsBody,
	updateScheduleNotificationsDto,
	type GetScheduleNotificationsDto,
	type UpdateScheduleNotificationsDto,
} from "../notifications/notifications.dto";
import { notificationsService } from "../notifications/notifications.service";
import { requireAuth } from "../auth/auth.middleware";
import { logger } from "@zerobyte/core/node";
import { asShortId } from "~/server/utils/branded";
import { cache, cacheKeys } from "~/server/utils/cache";
import { getScheduleByIdOrShortId } from "./helpers/backup-schedule-lookups";

export const backupScheduleController = new Hono()
	.use(requireAuth)
	.get("/", listBackupSchedulesDto, async (c) => {
		const schedules = await backupsService.listSchedules();

		return c.json<ListBackupSchedulesResponseDto>(listBackupSchedulesResponse.parse(schedules), 200);
	})
	.get("/:shortId", getBackupScheduleDto, async (c) => {
		const shortId = asShortId(c.req.param("shortId"));
		const schedule = await getScheduleByIdOrShortId(shortId);

		return c.json<GetBackupScheduleDto>(getBackupScheduleResponse.parse(schedule), 200);
	})
	.get("/volume/:volumeShortId", getBackupScheduleForVolumeDto, async (c) => {
		const volumeShortId = asShortId(c.req.param("volumeShortId"));
		const schedule = await backupsService.getScheduleForVolume(volumeShortId);

		return c.json<GetBackupScheduleForVolumeResponseDto>(getBackupScheduleForVolumeResponse.parse(schedule), 200);
	})
	.post("/", createBackupScheduleDto, validator("json", createBackupScheduleBody), async (c) => {
		const body = c.req.valid("json");
		const schedule = await backupsService.createSchedule(body);

		return c.json<CreateBackupScheduleDto>(createBackupScheduleResponse.parse(schedule), 201);
	})
	.patch("/:shortId", updateBackupScheduleDto, validator("json", updateBackupScheduleBody), async (c) => {
		const shortId = asShortId(c.req.param("shortId"));
		const body = c.req.valid("json");
		const schedule = await backupsService.updateSchedule(shortId, body);

		return c.json<UpdateBackupScheduleDto>(updateBackupScheduleResponse.parse(schedule), 200);
	})
	.delete("/:shortId", deleteBackupScheduleDto, async (c) => {
		const shortId = asShortId(c.req.param("shortId"));
		await backupsService.deleteSchedule(shortId);

		return c.json<DeleteBackupScheduleDto>({ success: true }, 200);
	})
	.post("/:shortId/run", runBackupNowDto, async (c) => {
		const shortId = asShortId(c.req.param("shortId"));
		const schedule = await getScheduleByIdOrShortId(shortId);
		const result = await backupsService.validateBackupExecution(schedule.id, true);

		if (result.type === "failure") {
			throw result.error;
		}

		if (result.type === "skipped") {
			return c.json<RunBackupNowDto>({ success: true }, 200);
		}

		backupsService.executeBackup(schedule.id, true).catch((err) => {
			logger.error(`Error executing manual backup for schedule ${shortId}:`, err);
		});

		return c.json<RunBackupNowDto>({ success: true }, 200);
	})
	.post("/:shortId/stop", stopBackupDto, async (c) => {
		const shortId = asShortId(c.req.param("shortId"));
		const schedule = await getScheduleByIdOrShortId(shortId);
		await backupsService.stopBackup(schedule.id);

		return c.json<StopBackupDto>({ success: true }, 200);
	})
	.post("/:shortId/forget", runForgetDto, async (c) => {
		const shortId = asShortId(c.req.param("shortId"));
		const schedule = await getScheduleByIdOrShortId(shortId);
		await backupsService.runForget(schedule.id);

		return c.json<RunForgetDto>({ success: true }, 200);
	})
	.get("/:shortId/notifications", getScheduleNotificationsDto, async (c) => {
		const shortId = asShortId(c.req.param("shortId"));
		const schedule = await getScheduleByIdOrShortId(shortId);
		const assignments = await notificationsService.getScheduleNotifications(schedule.id);

		return c.json<GetScheduleNotificationsDto>(assignments, 200);
	})
	.put(
		"/:shortId/notifications",
		updateScheduleNotificationsDto,
		validator("json", updateScheduleNotificationsBody),
		async (c) => {
			const shortId = asShortId(c.req.param("shortId"));
			const schedule = await getScheduleByIdOrShortId(shortId);
			const body = c.req.valid("json");
			const assignments = await notificationsService.updateScheduleNotifications(schedule.id, body.assignments);

			return c.json<UpdateScheduleNotificationsDto>(assignments, 200);
		},
	)
	.get("/:shortId/mirrors", getScheduleMirrorsDto, async (c) => {
		const shortId = asShortId(c.req.param("shortId"));
		const mirrors = await backupsService.getMirrors(shortId);

		return c.json<GetScheduleMirrorsDto>(mirrors, 200);
	})
	.put("/:shortId/mirrors", updateScheduleMirrorsDto, validator("json", updateScheduleMirrorsBody), async (c) => {
		const shortId = asShortId(c.req.param("shortId"));
		const body = c.req.valid("json");
		const mirrors = await backupsService.updateMirrors(shortId, body);

		return c.json<UpdateScheduleMirrorsDto>(mirrors, 200);
	})
	.get("/:shortId/mirrors/:mirrorShortId/status", getMirrorSyncStatusDto, async (c) => {
		const shortId = asShortId(c.req.param("shortId"));
		const mirrorShortId = asShortId(c.req.param("mirrorShortId"));
		const status = await backupsService.getMirrorSyncStatus(shortId, mirrorShortId);

		return c.json<GetMirrorSyncStatusDto>(status, 200);
	})
	.post("/:shortId/mirrors/:mirrorShortId/sync", syncMirrorDto, validator("json", syncMirrorBody), async (c) => {
		const shortId = asShortId(c.req.param("shortId"));
		const mirrorShortId = asShortId(c.req.param("mirrorShortId"));
		const body = c.req.valid("json");
		const result = await backupsService.syncMirror(shortId, mirrorShortId, body.snapshotIds);

		return c.json<SyncMirrorDto>(result, 200);
	})
	.get("/:shortId/mirrors/compatibility", getMirrorCompatibilityDto, async (c) => {
		const shortId = asShortId(c.req.param("shortId"));
		const compatibility = await backupsService.getMirrorCompatibility(shortId);

		return c.json<GetMirrorCompatibilityDto>(compatibility, 200);
	})
	.post("/reorder", reorderBackupSchedulesDto, validator("json", reorderBackupSchedulesBody), async (c) => {
		const body = c.req.valid("json");
		await backupsService.reorderSchedules(body.scheduleShortIds.map(asShortId));

		return c.json<ReorderBackupSchedulesDto>({ success: true }, 200);
	})
	.get("/:shortId/progress", getBackupProgressDto, async (c) => {
		const shortId = asShortId(c.req.param("shortId"));
		const schedule = await getScheduleByIdOrShortId(shortId);
		if (schedule.lastBackupStatus !== "in_progress") {
			cache.del(cacheKeys.backup.progress(schedule.id));
			return c.json<GetBackupProgressDto>(null, 200);
		}
		const progress = backupsService.getBackupProgress(schedule.id);

		return c.json<GetBackupProgressDto>(progress ?? null, 200);
	});
