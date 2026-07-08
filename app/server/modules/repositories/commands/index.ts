import { createDeleteSnapshotsCommand } from "./delete-snapshots-command";
import { createDoctorCommand, cancelDoctorTask } from "./doctor-command";
import { createTagSnapshotsCommand } from "./tag-snapshots-command";

export const commands = {
	createDeleteSnapshots: createDeleteSnapshotsCommand,
	createDoctor: createDoctorCommand,
	createTagSnapshots: createTagSnapshotsCommand,
	cancelDoctor: cancelDoctorTask,
};
