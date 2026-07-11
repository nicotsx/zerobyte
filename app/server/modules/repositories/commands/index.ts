import { createDeleteSnapshotsCommand } from "./delete-snapshots-command";
import { createDoctorCommand } from "./doctor-command";
import { createTagSnapshotsCommand } from "./tag-snapshots-command";
import { createRestoreCommand } from "./restore-command";

export const commands = {
	createDeleteSnapshots: createDeleteSnapshotsCommand,
	createDoctor: createDoctorCommand,
	createRestore: createRestoreCommand,
	createTagSnapshots: createTagSnapshotsCommand,
};
