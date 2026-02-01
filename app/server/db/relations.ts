import { defineRelations } from "drizzle-orm";
import * as schema from "./schema";

export const relations = defineRelations(schema, (r) => ({
	repositoriesTable: {
		backupSchedulesTablesViaBackupScheduleMirrorsTable: r.many.backupSchedulesTable({
			from: r.repositoriesTable.id.through(r.backupScheduleMirrorsTable.repositoryId),
			to: r.backupSchedulesTable.id.through(r.backupScheduleMirrorsTable.scheduleId),
			alias: "repositoriesTable_id_backupSchedulesTable_id_via_backupScheduleMirrorsTable",
		}),
		backupSchedules: r.many.backupSchedulesTable({
			alias: "backupSchedulesTable_repositoryId_repositoriesTable_id",
		}),
		organization: r.one.organization({
			from: r.repositoriesTable.organizationId,
			to: r.organization.id,
		}),
	},
	backupScheduleMirrorsTable: {
		repository: r.one.repositoriesTable({
			from: r.backupScheduleMirrorsTable.repositoryId,
			to: r.repositoriesTable.id,
			optional: false,
		}),
		backupSchedule: r.one.backupSchedulesTable({
			from: r.backupScheduleMirrorsTable.scheduleId,
			to: r.backupSchedulesTable.id,
			optional: false,
		}),
	},
	backupSchedulesTable: {
		mirrors: r.many.repositoriesTable({
			alias: "repositoriesTable_id_backupSchedulesTable_id_via_backupScheduleMirrorsTable",
		}),
		notificationDestinationsTables: r.many.notificationDestinationsTable(),
		organization: r.one.organization({
			from: r.backupSchedulesTable.organizationId,
			to: r.organization.id,
			optional: false,
		}),
		repository: r.one.repositoriesTable({
			from: r.backupSchedulesTable.repositoryId,
			to: r.repositoriesTable.id,
			alias: "backupSchedulesTable_repositoryId_repositoriesTable_id",
			optional: false,
		}),
		volume: r.one.volumesTable({
			from: r.backupSchedulesTable.volumeId,
			to: r.volumesTable.id,
			optional: false,
		}),
	},
	notificationDestinationsTable: {
		backupSchedules: r.many.backupSchedulesTable({
			from: r.notificationDestinationsTable.id.through(r.backupScheduleNotificationsTable.destinationId),
			to: r.backupSchedulesTable.id.through(r.backupScheduleNotificationsTable.scheduleId),
		}),
		organization: r.one.organization({
			from: r.notificationDestinationsTable.organizationId,
			to: r.organization.id,
		}),
	},
	account: {
		user: r.one.usersTable({
			from: r.account.userId,
			to: r.usersTable.id,
		}),
	},
	usersTable: {
		accounts: r.many.account(),
		sessions: r.many.sessionsTable(),
		members: r.many.member(),
		twoFactors: r.many.twoFactor(),
		organizations: r.many.organization({
			from: r.usersTable.id.through(r.member.userId),
			to: r.organization.id.through(r.member.organizationId),
			alias: "usersTable_id_organization_id_via_member",
		}),
	},
	sessionsTable: {
		user: r.one.usersTable({
			from: r.sessionsTable.userId,
			to: r.usersTable.id,
		}),
	},
	twoFactor: {
		usersTable: r.one.usersTable({
			from: r.twoFactor.userId,
			to: r.usersTable.id,
		}),
	},
	organization: {
		users: r.many.usersTable({
			alias: "usersTable_id_organization_id_via_member",
		}),
		backupSchedules: r.many.backupSchedulesTable(),
		notificationDestinations: r.many.notificationDestinationsTable(),
		repositories: r.many.repositoriesTable(),
		volumes: r.many.volumesTable(),
		members: r.many.member(),
		invitations: r.many.invitation(),
	},
	volumesTable: {
		backupSchedules: r.many.backupSchedulesTable(),
		organization: r.one.organization({
			from: r.volumesTable.organizationId,
			to: r.organization.id,
		}),
	},
	member: {
		user: r.one.usersTable({
			from: r.member.userId,
			to: r.usersTable.id,
			optional: false,
		}),
		organization: r.one.organization({
			from: r.member.organizationId,
			to: r.organization.id,
			optional: false,
		}),
	},
	invitation: {
		organization: r.one.organization({
			from: r.invitation.organizationId,
			to: r.organization.id,
			optional: false,
		}),
	},
	backupScheduleNotificationsTable: {
		destination: r.one.notificationDestinationsTable({
			from: r.backupScheduleNotificationsTable.destinationId,
			to: r.notificationDestinationsTable.id,
			optional: false,
		}),
		backupSchedule: r.one.backupSchedulesTable({
			from: r.backupScheduleNotificationsTable.scheduleId,
			to: r.backupSchedulesTable.id,
			optional: false,
		}),
	},
}));
