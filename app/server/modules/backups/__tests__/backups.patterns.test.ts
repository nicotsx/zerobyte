import { test, describe, mock, expect, beforeEach, afterEach, spyOn } from "bun:test";
import { backupsService } from "../backups.service";
import { createTestVolume } from "~/test/helpers/volume";
import { createTestBackupSchedule } from "~/test/helpers/backup";
import { createTestRepository } from "~/test/helpers/repository";
import { generateBackupOutput } from "~/test/helpers/restic";
import { getVolumePath } from "../../volumes/helpers";
import { restic } from "~/server/utils/restic";
import path from "node:path";

const backupMock = mock(() => Promise.resolve({ exitCode: 0, result: JSON.parse(generateBackupOutput()) }));

beforeEach(() => {
	backupMock.mockClear();
	spyOn(restic, "backup").mockImplementation(backupMock);
	spyOn(restic, "forget").mockImplementation(mock(() => Promise.resolve({ success: true })));
});

afterEach(() => {
	mock.restore();
});

describe("executeBackup - include / exclude patterns", () => {
	test("should correctly build include and exclude patterns by joining with volume path", async () => {
		// arrange
		const volume = await createTestVolume();
		const repository = await createTestRepository();
		const schedule = await createTestBackupSchedule({
			volumeId: volume.id,
			repositoryId: repository.id,
			includePatterns: ["include1", "subdir/include2"],
			excludePatterns: ["exclude1", "subdir/exclude2"],
			excludeIfPresent: [".nobackup"],
		});

		// act
		await backupsService.executeBackup(schedule.id);

		// assert
		const volumePath = getVolumePath(volume);

		expect(backupMock).toHaveBeenCalledWith(
			expect.anything(),
			volumePath,
			expect.objectContaining({
				include: [path.join(volumePath, "include1"), path.join(volumePath, "subdir/include2")],
				exclude: [path.join(volumePath, "exclude1"), path.join(volumePath, "subdir/exclude2")],
				excludeIfPresent: [".nobackup"],
			}),
		);
	});

	test("should not join with volume path if pattern already starts with it", async () => {
		// arrange
		const volume = await createTestVolume();
		const volumePath = getVolumePath(volume);
		const repository = await createTestRepository();

		const alreadyJoinedInclude = path.join(volumePath, "already/joined");
		const alreadyJoinedExclude = path.join(volumePath, "already/excluded");

		const schedule = await createTestBackupSchedule({
			volumeId: volume.id,
			repositoryId: repository.id,
			includePatterns: [alreadyJoinedInclude],
			excludePatterns: [alreadyJoinedExclude],
		});

		// act
		await backupsService.executeBackup(schedule.id);

		// assert
		expect(backupMock).toHaveBeenCalledWith(
			expect.anything(),
			volumePath,
			expect.objectContaining({
				include: [alreadyJoinedInclude],
				exclude: [alreadyJoinedExclude],
			}),
		);
	});

	test("should correctly mix relative and absolute patterns", async () => {
		// arrange
		const volume = await createTestVolume();
		const volumePath = getVolumePath(volume);
		const repository = await createTestRepository();

		const alreadyJoinedInclude = path.join(volumePath, "already/joined");
		const relativeInclude = "relative/include";

		const schedule = await createTestBackupSchedule({
			volumeId: volume.id,
			repositoryId: repository.id,
			includePatterns: [alreadyJoinedInclude, relativeInclude],
		});

		// act
		await backupsService.executeBackup(schedule.id);

		// assert
		expect(backupMock).toHaveBeenCalledWith(
			expect.anything(),
			volumePath,
			expect.objectContaining({
				include: [alreadyJoinedInclude, path.join(volumePath, relativeInclude)],
			}),
		);
	});

	test("should handle empty include and exclude patterns", async () => {
		// arrange
		const volume = await createTestVolume();
		const repository = await createTestRepository();
		const schedule = await createTestBackupSchedule({
			volumeId: volume.id,
			repositoryId: repository.id,
			includePatterns: [],
			excludePatterns: [],
		});

		// act
		await backupsService.executeBackup(schedule.id);

		// assert
		expect(backupMock).toHaveBeenCalledWith(
			expect.anything(),
			getVolumePath(volume),
			expect.not.objectContaining({
				include: expect.anything(),
				exclude: expect.anything(),
			}),
		);
	});
});
