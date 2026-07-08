import { createDeleteSnapshotsCommand } from "./delete-snapshots-command";
import { createTagSnapshotsCommand } from "./tag-snapshots-command";

export const commands = {
	createDeleteSnapshots: createDeleteSnapshotsCommand,
	createTagSnapshots: createTagSnapshotsCommand,
};
