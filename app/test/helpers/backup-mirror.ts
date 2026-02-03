import { db } from "~/server/db/db";
import { backupScheduleMirrorsTable, type BackupScheduleMirror } from "~/server/db/schema";
import { ensureTestOrganization } from "./organization";

type BackupScheduleMirrorInsert = Omit<BackupScheduleMirror, 'id' | 'createdAt'>;

export const createTestBackupScheduleMirror = async (
	scheduleId: number,
	repositoryId: string,
	overrides: Partial<BackupScheduleMirrorInsert> = {},
) => {
	await ensureTestOrganization();

	const mirror = {
		scheduleId,
		repositoryId,
		enabled: true,
		lastCopyAt: null,
		lastCopyStatus: null,
		lastCopyError: null,
		...overrides,
	};

	const data = await db.insert(backupScheduleMirrorsTable).values(mirror).returning();
	return data[0];
};
