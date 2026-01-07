import type {
	GetBackupScheduleResponse,
	GetRepositoryResponse,
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
