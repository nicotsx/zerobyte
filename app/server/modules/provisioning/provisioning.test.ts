import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { db } from "~/server/db/db";
import { backupSchedulesTable, repositoriesTable, volumesTable } from "~/server/db/schema";
import { restic } from "~/server/core/restic";
import { createTestSession } from "~/test/helpers/auth";
import { generateShortId } from "~/server/utils/id";
import { provisionedResourcesSchema, readProvisionedResourcesFile, syncProvisionedResources } from "./provisioning";
import { Effect } from "effect";

describe("provisioning", () => {
	let session: Awaited<ReturnType<typeof createTestSession>>;

	beforeAll(async () => {
		session = await createTestSession();
	});

	beforeEach(async () => {
		vi.spyOn(restic, "init").mockReturnValue(Effect.succeed({ success: true, error: null }));

		await db.delete(backupSchedulesTable);
		await db.delete(volumesTable);
		await db.delete(repositoriesTable);
	});

	afterEach(() => {
		vi.restoreAllMocks();
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

	test("enables automatic repository health checks by default", () => {
		const parsed = provisionedResourcesSchema.parse({
			repositories: [
				{
					id: "default-health-check",
					organizationId: "acme",
					name: "Default health check repository",
					backend: "local",
					config: { backend: "local", path: "/tmp/default-health-check" },
				},
			],
			volumes: [],
		});

		expect(parsed.repositories[0]?.autoCheckEnabled).toBe(true);
	});

	test("syncs provisioned repositories and volumes into the database", async () => {
		const { organizationId } = session;

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
						autoCheckEnabled: false,
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
		expect(repository.autoCheckEnabled).toBe(false);

		expect(volume).toBeTruthy();
		expect(volume?.status).toBe("mounted");
		expect(volume?.provisioningId).toBeDefined();
	});

	test("round-trips trusted filesystem source fields while preserving version 1", async () => {
		const { organizationId } = session;
		const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "zerobyte-provisioning-"));
		const provisioningPath = path.join(tempDir, "provisioning.json");
		const input = {
			version: 1 as const,
			repositories: [],
			volumes: [
				{
					id: "remote-photos",
					organizationId,
					name: "Remote photos",
					sourceKind: "agent-filesystem" as const,
					agentId: "agent-nas",
					trustedRootId: "photos",
					relativePath: "family/2026",
				},
			],
		};
		await fs.writeFile(provisioningPath, JSON.stringify(input));

		const parsed = await readProvisionedResourcesFile(provisioningPath);
		expect(parsed).toMatchObject(input);
		await syncProvisionedResources(provisioningPath);

		const volume = await db.query.volumesTable.findFirst({ where: { organizationId, name: "Remote photos" } });
		expect(volume).toMatchObject({
			sourceKind: "agent-filesystem",
			agentId: "agent-nas",
			trustedRootId: "photos",
			relativePath: "family/2026",
			config: null,
			type: null,
		});
	});

	test.each(["photos/archive", "bad root", "a".repeat(65), "   "])(
		"rejects invalid trusted root ID %j during document validation",
		(trustedRootId) => {
			const result = provisionedResourcesSchema.safeParse({
				volumes: [
					{
						id: "remote-photos",
						organizationId: session.organizationId,
						name: "Remote photos",
						sourceKind: "agent-filesystem",
						agentId: "not-enrolled",
						trustedRootId,
					},
				],
			});

			expect(result.success).toBe(false);
		},
	);

	test.each([
		{ relativePath: "../outside" },
		{ relativePath: "/absolute" },
		{ relativePath: "C:/absolute" },
		{ relativePath: "nested\\outside" },
		{ relativePath: "nested\0outside" },
		{ trustedRootId: "bad/root" },
	])("leaves earlier resources unchanged when a later trusted volume is invalid: %j", async (invalidLocation) => {
		const { organizationId } = session;
		const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "zerobyte-provisioning-"));
		const provisioningPath = path.join(tempDir, "provisioning.json");
		const repository = {
			id: "existing-repository",
			organizationId,
			name: "Original repository",
			backend: "local",
			config: { backend: "local", path: tempDir, isExistingRepository: true },
		};
		const volume = {
			id: "existing-volume",
			organizationId,
			name: "Original volume",
			backend: "directory",
			config: { backend: "directory", path: tempDir },
		};

		try {
			await fs.writeFile(provisioningPath, JSON.stringify({ repositories: [repository], volumes: [volume] }));
			await syncProvisionedResources(provisioningPath);

			const repositoriesBefore = await db.query.repositoriesTable.findMany({ where: { organizationId } });
			const volumesBefore = await db.query.volumesTable.findMany({ where: { organizationId } });

			await fs.writeFile(
				provisioningPath,
				JSON.stringify({
					repositories: [
						{ ...repository, name: "Changed repository" },
						{
							...repository,
							id: "new-repository",
							config: { ...repository.config, isExistingRepository: false },
						},
					],
					volumes: [
						{ ...volume, name: "Changed volume" },
						{ ...volume, id: "new-volume" },
						{
							id: "invalid-later-volume",
							organizationId,
							name: "Invalid source",
							sourceKind: "agent-filesystem",
							agentId: "not-enrolled",
							trustedRootId: "photos",
							relativePath: "",
							...invalidLocation,
						},
					],
				}),
			);

			await expect(syncProvisionedResources(provisioningPath)).rejects.toThrow();
			expect(await db.query.repositoriesTable.findMany({ where: { organizationId } })).toEqual(
				repositoriesBefore,
			);
			expect(await db.query.volumesTable.findMany({ where: { organizationId } })).toEqual(volumesBefore);
			expect(restic.init).not.toHaveBeenCalled();
		} finally {
			await fs.rm(tempDir, { recursive: true, force: true });
		}
	});

	test.each([
		["family//./2026/", "family/2026"],
		["./", ""],
		[undefined, ""],
	])(
		"normalizes trusted locations before inserting and updating without a live agent: %j",
		async (relativePath, expectedPath) => {
			const { organizationId } = session;
			const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "zerobyte-provisioning-"));
			const provisioningPath = path.join(tempDir, "provisioning.json");
			const volume = {
				id: "normalized-source",
				organizationId,
				name: "Normalized source",
				sourceKind: "agent-filesystem",
				agentId: "not-enrolled",
				trustedRootId: " photos ",
				relativePath,
			};

			try {
				await fs.writeFile(provisioningPath, JSON.stringify({ volumes: [volume] }));
				const parsed = await readProvisionedResourcesFile(provisioningPath);
				expect(parsed.volumes[0]).toMatchObject({ trustedRootId: "photos", relativePath: expectedPath });

				await syncProvisionedResources(provisioningPath);
				const inserted = await db.query.volumesTable.findFirst({
					where: { organizationId, name: volume.name },
				});
				expect(inserted).toMatchObject({ trustedRootId: "photos", relativePath: expectedPath });

				await fs.writeFile(
					provisioningPath,
					JSON.stringify({
						volumes: [{ ...volume, trustedRootId: " archive ", relativePath: "next//./year/" }],
					}),
				);
				await syncProvisionedResources(provisioningPath);
				const updated = await db.query.volumesTable.findFirst({ where: { organizationId, name: volume.name } });
				expect(updated).toMatchObject({
					id: inserted?.id,
					trustedRootId: "archive",
					relativePath: "next/year",
				});
			} finally {
				await fs.rm(tempDir, { recursive: true, force: true });
			}
		},
	);

	test("removes managed resources when delete is set", async () => {
		const { organizationId } = session;

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
		const { organizationId } = session;
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
		const { organizationId } = session;
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
		const { organizationId } = session;
		const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "zerobyte-provisioning-"));
		const provisioningPath = path.join(tempDir, "provisioning.json");
		const initMock = vi.fn(() => Effect.succeed({ success: true, error: null }));

		vi.spyOn(restic, "init").mockImplementation(initMock);

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
