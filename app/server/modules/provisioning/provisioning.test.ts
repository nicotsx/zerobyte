import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { db } from "~/server/db/db";
import { backupSchedulesTable, repositoriesTable } from "~/server/db/schema";
import { restic } from "~/server/core/restic";
import { createTestSession } from "~/test/helpers/auth";
import { generateShortId } from "~/server/utils/id";
import { provisionedResourcesSchema, readProvisionedResourcesFile, syncProvisionedResources } from "./provisioning";

describe("provisioning", () => {
	afterEach(() => {
		mock.restore();
	});

	test("rejects duplicate ids for the same organization", () => {
		expect(() =>
			provisionedResourcesSchema.parse({
				version: 1,
				repositories: [
					{
						id: "shared-id",
						organizationId: "acme",
						name: "Repository one",
						backend: "local",
						config: {
							backend: "local",
							path: "/tmp/one",
						},
					},
					{
						id: "shared-id",
						organizationId: "acme",
						name: "Repository two",
						backend: "local",
						config: {
							backend: "local",
							path: "/tmp/two",
						},
					},
				],
				volumes: [],
			}),
		).toThrow("Duplicate provisioned repository id for organization acme: shared-id");
	});

	test("syncs provisioned repositories and volumes into the database", async () => {
		const { organizationId } = await createTestSession();

		process.env.ZEROBYTE_PROVISIONED_ACCESS_KEY = "access-key-from-env";

		const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "zerobyte-provisioning-"));
		const provisioningPath = path.join(tempDir, "provisioning.json");

		await fs.writeFile(
			provisioningPath,
			JSON.stringify({
				version: 1,
				repositories: [
					{
						id: "aws-prod",
						organizationId,
						name: "AWS Production",
						backend: "s3",
						compressionMode: "auto",
						config: {
							backend: "s3",
							endpoint: "https://s3.amazonaws.com",
							bucket: "company-backups",
							accessKeyId: "env://ZEROBYTE_PROVISIONED_ACCESS_KEY",
							secretAccessKey: "plain-secret-key",
						},
					},
				],
				volumes: [
					{
						id: "shared-directory",
						organizationId,
						name: "Shared Directory",
						backend: "directory",
						autoRemount: true,
						config: {
							backend: "directory",
							path: tempDir,
						},
					},
				],
			}),
		);

		const parsed = await readProvisionedResourcesFile(provisioningPath);
		expect(parsed.repositories).toHaveLength(1);

		await syncProvisionedResources(provisioningPath);

		const repositories = await db.query.repositoriesTable.findMany({ where: { organizationId } });
		const volumes = await db.query.volumesTable.findMany({ where: { organizationId } });

		const repository = repositories.find((item) => item.name === "AWS Production");
		const volume = volumes.find((item) => item.name === "Shared Directory");

		expect(repository).toBeTruthy();
		if (!repository || repository.config.backend !== "s3") {
			throw new Error("Expected provisioned repository to be stored as an s3 repository");
		}
		expect(repository.config.accessKeyId).toBe("access-key-from-env");
		expect(repository.provisioningId).toBeDefined();

		expect(volume).toBeTruthy();
		expect(volume?.status).toBe("mounted");
		expect(volume?.provisioningId).toBeDefined();
	});

	test("removes managed resources when delete is set", async () => {
		const { organizationId } = await createTestSession();

		const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "zerobyte-provisioning-"));
		const provisioningPath = path.join(tempDir, "provisioning.json");

		await fs.writeFile(
			provisioningPath,
			JSON.stringify({
				version: 1,
				repositories: [
					{
						id: "repo-to-remove",
						organizationId,
						name: "Repo to remove",
						backend: "local",
						config: {
							backend: "local",
							path: tempDir,
							isExistingRepository: true,
						},
					},
				],
				volumes: [
					{
						id: "volume-to-remove",
						organizationId,
						name: "Volume to remove",
						backend: "directory",
						config: {
							backend: "directory",
							path: tempDir,
						},
					},
				],
			}),
		);

		await syncProvisionedResources(provisioningPath);

		await fs.writeFile(
			provisioningPath,
			JSON.stringify({
				version: 1,
				repositories: [
					{
						id: "repo-to-remove",
						organizationId,
						name: "Repo to remove",
						backend: "local",
						delete: true,
						config: {
							backend: "local",
							path: tempDir,
							isExistingRepository: true,
						},
					},
				],
				volumes: [
					{
						id: "volume-to-remove",
						organizationId,
						name: "Volume to remove",
						backend: "directory",
						delete: true,
						config: {
							backend: "directory",
							path: tempDir,
						},
					},
				],
			}),
		);

		await syncProvisionedResources(provisioningPath);

		const repositories = await db.query.repositoriesTable.findMany({ where: { organizationId } });
		const volumes = await db.query.volumesTable.findMany({ where: { organizationId } });

		expect(repositories.filter((item) => item.provisioningId)).toHaveLength(0);
		expect(volumes.filter((item) => item.provisioningId)).toHaveLength(0);
	});

	test("renaming a provisioned volume updates it in place", async () => {
		const { organizationId } = await createTestSession();
		const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "zerobyte-provisioning-"));
		const provisioningPath = path.join(tempDir, "provisioning.json");
		const provisionedVolumeId = "shared-directory";

		await db.insert(repositoriesTable).values({
			id: crypto.randomUUID(),
			shortId: generateShortId(),
			name: "Schedule Repository",
			type: "local",
			config: {
				backend: "local",
				path: tempDir,
				isExistingRepository: true,
			},
			organizationId,
		});

		await fs.writeFile(
			provisioningPath,
			JSON.stringify({
				version: 1,
				repositories: [],
				volumes: [
					{
						id: provisionedVolumeId,
						organizationId,
						name: "Shared Directory",
						backend: "directory",
						config: {
							backend: "directory",
							path: tempDir,
						},
					},
				],
			}),
		);

		await syncProvisionedResources(provisioningPath);

		const initialVolume = await db.query.volumesTable.findFirst({
			where: { organizationId, provisioningId: `provisioned:${organizationId}:${provisionedVolumeId}` },
		});
		expect(initialVolume).toBeTruthy();
		if (!initialVolume) {
			throw new Error("Expected initial provisioned volume to exist");
		}

		const repository = await db.query.repositoriesTable.findFirst({ where: { organizationId } });
		expect(repository).toBeTruthy();
		if (!repository) {
			throw new Error("Expected repository to exist");
		}

		const [schedule] = await db
			.insert(backupSchedulesTable)
			.values({
				shortId: generateShortId(),
				name: "Daily Backup",
				volumeId: initialVolume.id,
				repositoryId: repository.id,
				cronExpression: "0 0 * * *",
				organizationId,
			})
			.returning();

		await fs.writeFile(
			provisioningPath,
			JSON.stringify({
				version: 1,
				repositories: [],
				volumes: [
					{
						id: provisionedVolumeId,
						organizationId,
						name: "Shared Directory Renamed",
						backend: "directory",
						config: {
							backend: "directory",
							path: tempDir,
						},
					},
				],
			}),
		);

		await syncProvisionedResources(provisioningPath);

		const volumes = await db.query.volumesTable.findMany({ where: { organizationId } });
		expect(volumes).toHaveLength(1);
		expect(volumes[0]?.id).toBe(initialVolume.id);
		expect(volumes[0]?.name).toBe("Shared Directory Renamed");
		expect(volumes[0]?.provisioningId).toBe(`provisioned:${organizationId}:${provisionedVolumeId}`);

		const persistedSchedule = await db.query.backupSchedulesTable.findFirst({ where: { id: schedule.id } });
		expect(persistedSchedule).toBeTruthy();
		expect(persistedSchedule?.volumeId).toBe(initialVolume.id);
	});

	test("does not partially sync resources when resolving a provisioned secret fails", async () => {
		const { organizationId } = await createTestSession();
		const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "zerobyte-provisioning-"));
		const provisioningPath = path.join(tempDir, "provisioning.json");

		await fs.writeFile(
			provisioningPath,
			JSON.stringify({
				version: 1,
				repositories: [
					{
						id: "broken-secret-repo",
						organizationId,
						name: "Broken Secret Repo",
						backend: "rest",
						config: {
							backend: "rest",
							url: "https://rest.example.test",
							password: "file://ZEROBYTE_WEBDAV_PASSWORD",
						},
					},
				],
				volumes: [
					{
						id: "shared-directory",
						organizationId,
						name: "Shared Directory",
						backend: "directory",
						config: {
							backend: "directory",
							path: tempDir,
						},
					},
				],
			}),
		);

		await expect(syncProvisionedResources(provisioningPath)).rejects.toThrow(
			"Provisioned secret file not found: /run/secrets/ZEROBYTE_WEBDAV_PASSWORD",
		);

		const repositories = await db.query.repositoriesTable.findMany({ where: { organizationId } });
		const volumes = await db.query.volumesTable.findMany({ where: { organizationId } });

		expect(repositories.filter((repository) => repository.provisioningId)).toHaveLength(0);
		expect(volumes.filter((volume) => volume.provisioningId)).toHaveLength(0);
	});

	test("initializes a non-existing provisioned repository on first sync", async () => {
		const { organizationId } = await createTestSession();
		const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "zerobyte-provisioning-"));
		const provisioningPath = path.join(tempDir, "provisioning.json");
		const initMock = mock(() => Promise.resolve({ success: true, error: null }));

		spyOn(restic, "init").mockImplementation(initMock);

		await fs.writeFile(
			provisioningPath,
			JSON.stringify({
				version: 1,
				repositories: [
					{
						id: "new-local-repo",
						organizationId,
						name: "New Local Repo",
						backend: "local",
						config: {
							backend: "local",
							path: tempDir,
							isExistingRepository: false,
						},
					},
				],
				volumes: [],
			}),
		);

		await syncProvisionedResources(provisioningPath);

		expect(initMock).toHaveBeenCalledTimes(1);

		const repository = await db.query.repositoriesTable.findFirst({
			where: {
				organizationId,
				provisioningId: `provisioned:${organizationId}:new-local-repo`,
			},
		});

		expect(repository).toBeTruthy();
		expect(repository?.status).toBe("healthy");
		expect(repository?.lastChecked).toEqual(expect.any(Number));
		expect(repository?.lastError).toBeNull();
	});
});
