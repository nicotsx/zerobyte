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

export const backupScheduleController = new Hono()
	.get("/", listBackupSchedulesDto, async (c) => {
		const schedules = await backupsService.listSchedules();

		return c.json<ListBackupSchedulesResponseDto>(schedules, 200);
	})
	.get("/:scheduleId", getBackupScheduleDto, async (c) => {
		const scheduleId = c.req.param("scheduleId");

		const schedule = await backupsService.getSchedule(Number(scheduleId));

		return c.json<GetBackupScheduleDto>(schedule, 200);
	})
	.get("/volume/:volumeId", getBackupScheduleForVolumeDto, async (c) => {
		const volumeId = c.req.param("volumeId");
		const schedule = await backupsService.getScheduleForVolume(Number(volumeId));

		return c.json<GetBackupScheduleForVolumeResponseDto>(schedule, 200);
	})
	.post("/", createBackupScheduleDto, validator("json", createBackupScheduleBody), async (c) => {
		const body = c.req.valid("json");

		const schedule = await backupsService.createSchedule(body);

		return c.json<CreateBackupScheduleDto>(schedule, 201);
	})
	.patch("/:scheduleId", updateBackupScheduleDto, validator("json", updateBackupScheduleBody), async (c) => {
		const scheduleId = c.req.param("scheduleId");
		const body = c.req.valid("json");

		const schedule = await backupsService.updateSchedule(Number(scheduleId), body);

		return c.json<UpdateBackupScheduleDto>(schedule, 200);
	})
	.delete("/:scheduleId", deleteBackupScheduleDto, async (c) => {
		const scheduleId = c.req.param("scheduleId");

		await backupsService.deleteSchedule(Number(scheduleId));

		return c.json<DeleteBackupScheduleDto>({ success: true }, 200);
	})
	.post("/:scheduleId/run", runBackupNowDto, async (c) => {
		const scheduleId = c.req.param("scheduleId");

		backupsService.executeBackup(Number(scheduleId), true).catch((err) => {
			console.error(`Error executing manual backup for schedule ${scheduleId}:`, err);
		});

		return c.json<RunBackupNowDto>({ success: true }, 200);
	})
	.post("/:scheduleId/stop", stopBackupDto, async (c) => {
		const scheduleId = c.req.param("scheduleId");

		await backupsService.stopBackup(Number(scheduleId));

		return c.json<StopBackupDto>({ success: true }, 200);
	})
	.post("/:scheduleId/forget", runForgetDto, async (c) => {
		const scheduleId = c.req.param("scheduleId");

		await backupsService.runForget(Number(scheduleId));

		return c.json<RunForgetDto>({ success: true }, 200);
	})
	.get("/:scheduleId/notifications", getScheduleNotificationsDto, async (c) => {
		const scheduleId = Number.parseInt(c.req.param("scheduleId"), 10);
		const assignments = await notificationsService.getScheduleNotifications(scheduleId);

		return c.json<GetScheduleNotificationsDto>(assignments, 200);
	})
	.put(
		"/:scheduleId/notifications",
		updateScheduleNotificationsDto,
		validator("json", updateScheduleNotificationsBody),
		async (c) => {
			const scheduleId = Number.parseInt(c.req.param("scheduleId"), 10);
			const body = c.req.valid("json");
			const assignments = await notificationsService.updateScheduleNotifications(scheduleId, body.assignments);

			return c.json<UpdateScheduleNotificationsDto>(assignments, 200);
		},
	)
	.get("/:scheduleId/mirrors", getScheduleMirrorsDto, async (c) => {
		const scheduleId = Number.parseInt(c.req.param("scheduleId"), 10);
		const mirrors = await backupsService.getMirrors(scheduleId);

		return c.json<GetScheduleMirrorsDto>(mirrors, 200);
	})
	.put("/:scheduleId/mirrors", updateScheduleMirrorsDto, validator("json", updateScheduleMirrorsBody), async (c) => {
		const scheduleId = Number.parseInt(c.req.param("scheduleId"), 10);
		const body = c.req.valid("json");
		const mirrors = await backupsService.updateMirrors(scheduleId, body);

		return c.json<UpdateScheduleMirrorsDto>(mirrors, 200);
	})
	.get("/:scheduleId/mirrors/compatibility", getMirrorCompatibilityDto, async (c) => {
		const scheduleId = Number.parseInt(c.req.param("scheduleId"), 10);
		const compatibility = await backupsService.getMirrorCompatibility(scheduleId);

		return c.json<GetMirrorCompatibilityDto>(compatibility, 200);
	})
	.post("/reorder", reorderBackupSchedulesDto, validator("json", reorderBackupSchedulesBody), async (c) => {
		const body = c.req.valid("json");

		await backupsService.reorderSchedules(body.scheduleIds);

		return c.json<ReorderBackupSchedulesDto>({ success: true }, 200);
	});
