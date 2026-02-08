import type {
	GetBackupScheduleResponse,
	GetRepositoryResponse,
	GetScheduleMirrorsResponse,
	GetScheduleNotificationsResponse,
	GetVolumeResponse,
	ListNotificationDestinationsResponse,
	ListSnapshotsResponse,
} from "../api-client";

export type Volume = GetVolumeResponse["volume"];
export type StatFs = GetVolumeResponse["statfs"];
export type VolumeStatus = Volume["status"];

export type Repository = GetRepositoryResponse;

export type BackupSchedule = GetBackupScheduleResponse;

export type Snapshot = ListSnapshotsResponse[number];

export type NotificationDestination = ListNotificationDestinationsResponse[number];

export type ScheduleNotification = GetScheduleNotificationsResponse[number];
export type ScheduleMirror = GetScheduleMirrorsResponse[number];
