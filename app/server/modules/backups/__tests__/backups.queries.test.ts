import { test, describe, expect, beforeEach } from "bun:test";
import { scheduleQueries } from "../backups.queries";
import { createTestBackupSchedule } from "~/test/helpers/backup";
import { createTestVolume } from "~/test/helpers/volume";
import { createTestRepository } from "~/test/helpers/repository";
import { TEST_ORG_ID } from "~/test/helpers/organization";
import { faker } from "@faker-js/faker";

describe("scheduleQueries.findExecutable", () => {
	let volume: { id: number };
	let repository: { id: string };

	beforeEach(async () => {
		volume = await createTestVolume();
		repository = await createTestRepository();
	});

	test("should return enabled schedules with null nextBackupAt", async () => {
		// arrange
		const schedule = await createTestBackupSchedule({
			volumeId: volume.id,
			repositoryId: repository.id,
			enabled: true,
			nextBackupAt: null,
			lastBackupStatus: null,
		});

		// act
		const result = await scheduleQueries.findExecutable(TEST_ORG_ID);

		// assert
		expect(result).toContain(schedule.id);
	});

	test("should return enabled schedules with past nextBackupAt", async () => {
		// arrange
		const pastTime = faker.date.past().getTime();
		const schedule = await createTestBackupSchedule({
			volumeId: volume.id,
			repositoryId: repository.id,
			enabled: true,
			nextBackupAt: pastTime,
			lastBackupStatus: null,
		});

		// act
		const result = await scheduleQueries.findExecutable(TEST_ORG_ID);

		// assert
		expect(result).toContain(schedule.id);
	});

	test("should not return schedules with future nextBackupAt", async () => {
		// arrange
		const futureTime = faker.date.future().getTime();
		const schedule = await createTestBackupSchedule({
			volumeId: volume.id,
			repositoryId: repository.id,
			enabled: true,
			nextBackupAt: futureTime,
			lastBackupStatus: null,
		});

		// act
		const result = await scheduleQueries.findExecutable(TEST_ORG_ID);

		// assert
		expect(result).not.toContain(schedule.id);
	});

	test("should not return disabled schedules", async () => {
		// arrange
		const schedule = await createTestBackupSchedule({
			volumeId: volume.id,
			repositoryId: repository.id,
			enabled: false,
			nextBackupAt: null,
			lastBackupStatus: null,
		});

		// act
		const result = await scheduleQueries.findExecutable(TEST_ORG_ID);

		// assert
		expect(result).not.toContain(schedule.id);
	});

	test("should not return schedules with in_progress status", async () => {
		// arrange
		const schedule = await createTestBackupSchedule({
			volumeId: volume.id,
			repositoryId: repository.id,
			enabled: true,
			nextBackupAt: null,
			lastBackupStatus: "in_progress",
		});

		// act
		const result = await scheduleQueries.findExecutable(TEST_ORG_ID);

		// assert
		expect(result).not.toContain(schedule.id);
	});

	test("should return schedules with success status and past nextBackupAt", async () => {
		// arrange
		const pastTime = faker.date.past().getTime();
		const schedule = await createTestBackupSchedule({
			volumeId: volume.id,
			repositoryId: repository.id,
			enabled: true,
			nextBackupAt: pastTime,
			lastBackupStatus: "success",
		});

		// act
		const result = await scheduleQueries.findExecutable(TEST_ORG_ID);

		// assert
		expect(result).toContain(schedule.id);
	});

	test("should return schedules with error status and null nextBackupAt", async () => {
		// arrange
		const schedule = await createTestBackupSchedule({
			volumeId: volume.id,
			repositoryId: repository.id,
			enabled: true,
			nextBackupAt: null,
			lastBackupStatus: "error",
		});

		// act
		const result = await scheduleQueries.findExecutable(TEST_ORG_ID);

		// assert
		expect(result).toContain(schedule.id);
	});

	test("should not return schedules from other organizations", async () => {
		// arrange
		const otherOrgId = faker.string.uuid();
		const schedule = await createTestBackupSchedule({
			volumeId: volume.id,
			repositoryId: repository.id,
			enabled: true,
			nextBackupAt: null,
			lastBackupStatus: null,
			organizationId: otherOrgId,
		});

		// act
		const result = await scheduleQueries.findExecutable(TEST_ORG_ID);

		// assert
		expect(result).not.toContain(schedule.id);
	});

	test("should only return schedule IDs", async () => {
		// arrange
		await createTestBackupSchedule({
			volumeId: volume.id,
			repositoryId: repository.id,
			enabled: true,
			nextBackupAt: null,
			lastBackupStatus: null,
		});

		// act
		const result = await scheduleQueries.findExecutable(TEST_ORG_ID);

		// assert
		expect(result.length).toBeGreaterThan(0);
		for (const id of result) {
			expect(typeof id).toBe("number");
		}
	});
});
