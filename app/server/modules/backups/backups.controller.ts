import { Hono } from "hono";
import { validator } from "hono-openapi";
import {
	createBackupScheduleBody,
	createBackupScheduleDto,
	deleteBackupScheduleDto,
	getBackupScheduleDto,
	getBackupScheduleForVolumeDto,
	listBackupSchedulesDto,
	runBackupNowDto,
	runForgetDto,
	stopBackupDto,
	updateBackupScheduleDto,
	updateBackupScheduleBody,
	getScheduleMirrorsDto,
	updateScheduleMirrorsDto,
	updateScheduleMirrorsBody,
	getMirrorCompatibilityDto,
	reorderBackupSchedulesDto,
	reorderBackupSchedulesBody,
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
import { backupsExecutionService } from "./backups.execution";
import { logger } from "~/server/utils/logger";

export const backupScheduleController = new Hono()
	.use(requireAuth)
	.get("/", listBackupSchedulesDto, async (c) => {
		const schedules = await backupsService.listSchedules();

		return c.json<ListBackupSchedulesResponseDto>(schedules, 200);
	})
	.get("/:shortId", getBackupScheduleDto, async (c) => {
		const shortId = c.req.param("shortId");
		const schedule = await backupsService.getScheduleByShortId(shortId);

		return c.json<GetBackupScheduleDto>(schedule, 200);
	})
	.get("/volume/:volumeShortId", getBackupScheduleForVolumeDto, async (c) => {
		const volumeShortId = c.req.param("volumeShortId");
		const schedule = await backupsService.getScheduleForVolume(volumeShortId);

		return c.json<GetBackupScheduleForVolumeResponseDto>(schedule, 200);
	})
	.post("/", createBackupScheduleDto, validator("json", createBackupScheduleBody), async (c) => {
		const body = c.req.valid("json");
		const schedule = await backupsService.createSchedule(body);

		return c.json<CreateBackupScheduleDto>(schedule, 201);
	})
	.patch("/:shortId", updateBackupScheduleDto, validator("json", updateBackupScheduleBody), async (c) => {
		const shortId = c.req.param("shortId");
		const body = c.req.valid("json");
		const schedule = await backupsService.updateSchedule(shortId, body);

		return c.json<UpdateBackupScheduleDto>(schedule, 200);
	})
	.delete("/:shortId", deleteBackupScheduleDto, async (c) => {
		const shortId = c.req.param("shortId");
		await backupsService.deleteSchedule(shortId);

		return c.json<DeleteBackupScheduleDto>({ success: true }, 200);
	})
	.post("/:shortId/run", runBackupNowDto, async (c) => {
		const shortId = c.req.param("shortId");
		const schedule = await backupsService.getScheduleByShortId(shortId);
		const result = await backupsExecutionService.validateBackupExecution(schedule.id, true);

		if (result.type === "failure") {
			throw result.error;
		}

		if (result.type === "skipped") {
			return c.json<RunBackupNowDto>({ success: true }, 200);
		}

		backupsExecutionService.executeBackup(schedule.id, true).catch((err) => {
			logger.error(`Error executing manual backup for schedule ${shortId}:`, err);
		});

		return c.json<RunBackupNowDto>({ success: true }, 200);
	})
	.post("/:shortId/stop", stopBackupDto, async (c) => {
		const shortId = c.req.param("shortId");
		const schedule = await backupsService.getScheduleByShortId(shortId);
		await backupsExecutionService.stopBackup(schedule.id);

		return c.json<StopBackupDto>({ success: true }, 200);
	})
	.post("/:shortId/forget", runForgetDto, async (c) => {
		const shortId = c.req.param("shortId");
		const schedule = await backupsService.getScheduleByShortId(shortId);
		await backupsExecutionService.runForget(schedule.id);

		return c.json<RunForgetDto>({ success: true }, 200);
	})
	.get("/:shortId/notifications", getScheduleNotificationsDto, async (c) => {
		const shortId = c.req.param("shortId");
		const schedule = await backupsService.getScheduleByShortId(shortId);
		const assignments = await notificationsService.getScheduleNotifications(schedule.id);

		return c.json<GetScheduleNotificationsDto>(assignments, 200);
	})
	.put(
		"/:shortId/notifications",
		updateScheduleNotificationsDto,
		validator("json", updateScheduleNotificationsBody),
		async (c) => {
			const shortId = c.req.param("shortId");
			const schedule = await backupsService.getScheduleByShortId(shortId);
			const body = c.req.valid("json");
			const assignments = await notificationsService.updateScheduleNotifications(schedule.id, body.assignments);

			return c.json<UpdateScheduleNotificationsDto>(assignments, 200);
		},
	)
	.get("/:shortId/mirrors", getScheduleMirrorsDto, async (c) => {
		const shortId = c.req.param("shortId");
		const mirrors = await backupsService.getMirrors(shortId);

		return c.json<GetScheduleMirrorsDto>(mirrors, 200);
	})
	.put("/:shortId/mirrors", updateScheduleMirrorsDto, validator("json", updateScheduleMirrorsBody), async (c) => {
		const shortId = c.req.param("shortId");
		const body = c.req.valid("json");
		const mirrors = await backupsService.updateMirrors(shortId, body);

		return c.json<UpdateScheduleMirrorsDto>(mirrors, 200);
	})
	.get("/:shortId/mirrors/compatibility", getMirrorCompatibilityDto, async (c) => {
		const shortId = c.req.param("shortId");
		const compatibility = await backupsService.getMirrorCompatibility(shortId);

		return c.json<GetMirrorCompatibilityDto>(compatibility, 200);
	})
	.post("/reorder", reorderBackupSchedulesDto, validator("json", reorderBackupSchedulesBody), async (c) => {
		const body = c.req.valid("json");
		await backupsService.reorderSchedules(body.scheduleShortIds);

		return c.json<ReorderBackupSchedulesDto>({ success: true }, 200);
	});
