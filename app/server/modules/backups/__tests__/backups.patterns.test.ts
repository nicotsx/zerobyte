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
	spyOn(restic, "forget").mockImplementation(mock(() => Promise.resolve({ success: true, data: null })));
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

	test("should handle the case where a subfolder has the exact same name as the volume name", async () => {
		// arrange
		const volumeName = "SyncFolder";
		const volume = await createTestVolume({
			name: volumeName,
			type: "directory",
			config: { backend: "directory", path: `/${volumeName}` },
		});
		const volumePath = getVolumePath(volume);
		const repository = await createTestRepository();

		const selectedPath = `/${volumeName}`; // Selection of the folder inside the volume

		const schedule = await createTestBackupSchedule({
			volumeId: volume.id,
			repositoryId: repository.id,
			includePatterns: [selectedPath],
		});

		// act
		await backupsExecutionService.executeBackup(schedule.id);

		// assert
		expect(backupMock).toHaveBeenCalledWith(
			expect.anything(),
			volumePath,
			expect.objectContaining({
				// Should produce /SyncFolder/SyncFolder and not just /SyncFolder
				include: [path.join(volumePath, volumeName)],
			}),
		);
	});

	test("should correctly mix relative and absolute patterns", async () => {
		// arrange
		const volume = await createTestVolume();
		const volumePath = getVolumePath(volume);
		const repository = await createTestRepository();

		const relativeInclude = "relative/include";
		const anchoredInclude = "/anchored/include";

		const schedule = await createTestBackupSchedule({
			volumeId: volume.id,
			repositoryId: repository.id,
			includePatterns: [relativeInclude, anchoredInclude],
		});

		// act
		await backupsExecutionService.executeBackup(schedule.id);

		// assert
		expect(backupMock).toHaveBeenCalledWith(
			expect.anything(),
			volumePath,
			expect.objectContaining({
				include: [relativeInclude, path.join(volumePath, "anchored/include")],
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
