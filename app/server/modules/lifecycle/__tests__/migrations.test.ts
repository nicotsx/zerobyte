import { afterEach, describe, expect, test, vi } from "vitest";
import { db } from "~/server/db/db";
import { createTestBackupSchedule } from "~/test/helpers/backup";
import { createTestBackupScheduleMirror } from "~/test/helpers/backup-mirror";
import { createTestRepository } from "~/test/helpers/repository";
import { v00008 } from "../migrations/00008-backfill-mirror-sync-tasks";

const createLegacyMirror = async (lastCopyStatus: "success" | "error" | "in_progress", lastCopyAt: number | null) => {
	const schedule = await createTestBackupSchedule();
	const mirrorRepository = await createTestRepository();
	const mirror = await createTestBackupScheduleMirror(schedule.id, mirrorRepository.id, {
		lastCopyStatus,
		lastCopyAt,
	});

	return { mirror, mirrorRepository, schedule };
};

afterEach(() => {
	vi.useRealTimers();
});

describe("00008-backfill-mirror-sync-tasks", () => {
	test("backfills a successful mirror sync as finished at the reliable legacy timestamp", async () => {
		const lastCopyAt = 1_725_000_000_000;
		const { mirror, mirrorRepository, schedule } = await createLegacyMirror("success", lastCopyAt);

		await expect(v00008.execute()).resolves.toEqual({ success: true, errors: [] });

		const task = await db.query.tasksTable.findFirst({
			where: { id: `legacy-mirror-sync:${mirror.id}` },
		});
		expect(task).toMatchObject({
			kind: "mirrorSync",
			status: "succeeded",
			resourceType: "backup_schedule",
			resourceId: schedule.shortId,
			operationKey: mirrorRepository.shortId,
			result: { kind: "mirrorSync" },
			createdAt: lastCopyAt,
			updatedAt: lastCopyAt,
			finishedAt: lastCopyAt,
		});
	});

	test.each(["success", "error"] as const)(
		"omits a %s mirror sync without a reliable legacy timestamp",
		async (lastCopyStatus) => {
			const { mirror } = await createLegacyMirror(lastCopyStatus, null);

			await expect(v00008.execute()).resolves.toEqual({ success: true, errors: [] });

			const task = await db.query.tasksTable.findFirst({
				where: { id: `legacy-mirror-sync:${mirror.id}` },
			});
			expect(task).toBeUndefined();
		},
	);

	test("backfills an in-progress mirror sync as stale at migration time", async () => {
		const oldLastCopyAt = 1_725_000_000_000;
		const migrationTime = 1_800_000_000_000;
		vi.useFakeTimers({ now: migrationTime });
		const { mirror } = await createLegacyMirror("in_progress", oldLastCopyAt);

		await expect(v00008.execute()).resolves.toEqual({ success: true, errors: [] });

		const task = await db.query.tasksTable.findFirst({
			where: { id: `legacy-mirror-sync:${mirror.id}` },
		});
		expect(task).toMatchObject({
			kind: "mirrorSync",
			status: "stale",
			createdAt: migrationTime,
			updatedAt: migrationTime,
			finishedAt: migrationTime,
		});
		expect(task?.finishedAt).not.toBe(oldLastCopyAt);
	});

	test("is critical", () => {
		expect(v00008.type).toBe("critical");
	});
});
