import { layout, type RouteConfig, route } from "@react-router/dev/routes";

export default [
	route("onboarding", "./client/modules/auth/routes/onboarding.tsx"),
	route("login", "./client/modules/auth/routes/login.tsx"),
	route("download-recovery-key", "./client/modules/auth/routes/download-recovery-key.tsx"),
	layout("./client/components/layout.tsx", [
		route("/", "./client/routes/root.tsx"),
		route("volumes", "./client/modules/volumes/routes/volumes.tsx"),
		route("volumes/create", "./client/modules/volumes/routes/create-volume.tsx"),
		route("volumes/:name", "./client/modules/volumes/routes/volume-details.tsx"),
		route("backups", "./client/modules/backups/routes/backups.tsx"),
		route("backups/create", "./client/modules/backups/routes/create-backup.tsx"),
		route("backups/:id", "./client/modules/backups/routes/backup-details.tsx"),
		route("backups/:id/:snapshotId/restore", "./client/modules/backups/routes/restore-snapshot.tsx"),
		route("repositories", "./client/modules/repositories/routes/repositories.tsx"),
		route("repositories/create", "./client/modules/repositories/routes/create-repository.tsx"),
		route("repositories/:id", "./client/modules/repositories/routes/repository-details.tsx"),
		route("repositories/:id/:snapshotId", "./client/modules/repositories/routes/snapshot-details.tsx"),
		route("repositories/:id/:snapshotId/restore", "./client/modules/repositories/routes/restore-snapshot.tsx"),
		route("notifications", "./client/modules/notifications/routes/notifications.tsx"),
		route("notifications/create", "./client/modules/notifications/routes/create-notification.tsx"),
		route("notifications/:id", "./client/modules/notifications/routes/notification-details.tsx"),
		route("settings", "./client/modules/settings/routes/settings.tsx"),
	]),
] satisfies RouteConfig;
