import { test, describe, mock, expect, beforeEach, afterEach, spyOn } from "bun:test";
import { createTestVolume } from "~/test/helpers/volume";
import { createTestBackupSchedule } from "~/test/helpers/backup";
import { createTestRepository } from "~/test/helpers/repository";
import { generateBackupOutput } from "~/test/helpers/restic";
import { getVolumePath } from "../../volumes/helpers";
import { restic } from "~/server/utils/restic";
import path from "node:path";
import { TEST_ORG_ID } from "~/test/helpers/organization";
import * as context from "~/server/core/request-context";
import { backupsExecutionService } from "../backups.execution";

const backupMock = mock(() => Promise.resolve({ exitCode: 0, result: JSON.parse(generateBackupOutput()) }));

beforeEach(() => {
	backupMock.mockClear();
	spyOn(restic, "backup").mockImplementation(backupMock);
	spyOn(restic, "forget").mockImplementation(mock(() => Promise.resolve({ success: true })));
	spyOn(context, "getOrganizationId").mockReturnValue(TEST_ORG_ID);
});

afterEach(() => {
	mock.restore();
});

describe("executeBackup - include / exclude patterns", () => {
	test("should correctly build include and exclude patterns", async () => {
		// arrange
		const volume = await createTestVolume();
		const repository = await createTestRepository();
		const volumePath = getVolumePath(volume);

		const schedule = await createTestBackupSchedule({
			volumeId: volume.id,
			repositoryId: repository.id,
			includePatterns: ["*.zip", "/Photos", "!/Temp", "!*.log"],
			excludePatterns: [".DS_Store", "/Config", "!/Important", "!*.tmp"],
			excludeIfPresent: [".nobackup"],
		});

		// act
		await backupsExecutionService.executeBackup(schedule.id);

		// assert
		expect(backupMock).toHaveBeenCalledWith(
			expect.anything(),
			volumePath,
			expect.objectContaining({
				include: ["*.zip", path.join(volumePath, "Photos"), `!${path.join(volumePath, "Temp")}`, "!*.log"],
				exclude: [".DS_Store", path.join(volumePath, "Config"), `!${path.join(volumePath, "Important")}`, "!*.tmp"],
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
		await backupsExecutionService.executeBackup(schedule.id);

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
		const anchoredInclude = "/anchored/include";

		const schedule = await createTestBackupSchedule({
			volumeId: volume.id,
			repositoryId: repository.id,
			includePatterns: [alreadyJoinedInclude, relativeInclude, anchoredInclude],
		});

		// act
		await backupsExecutionService.executeBackup(schedule.id);

		// assert
		expect(backupMock).toHaveBeenCalledWith(
			expect.anything(),
			volumePath,
			expect.objectContaining({
				include: [alreadyJoinedInclude, relativeInclude, path.join(volumePath, "anchored/include")],
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
		await backupsExecutionService.executeBackup(schedule.id);

		// assert
		expect(backupMock).toHaveBeenCalledWith(
			expect.anything(),
			getVolumePath(volume),
			expect.objectContaining({
				include: [],
				exclude: [],
			}),
		);
	});
});
