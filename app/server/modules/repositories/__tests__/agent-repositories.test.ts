import { eq } from "drizzle-orm";
import { Effect } from "effect";
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import type { RepositoryConfig } from "@zerobyte/core/restic";
import { REPOSITORY_BASE } from "~/server/core/constants";
import { restic, resticDeps } from "~/server/core/restic";
import { withContext } from "~/server/core/request-context";
import { db } from "~/server/db/db";
import { agentsTable, repositoriesTable } from "~/server/db/schema";
import { agentManager } from "~/server/modules/agents/agents-manager";
import { agentsService } from "~/server/modules/agents/agents.service";
import { generateShortId } from "~/server/utils/id";
import { createTestSession } from "~/test/helpers/auth";
import { createTestBackupSchedule } from "~/test/helpers/backup";
import { createTestRepository } from "~/test/helpers/repository";
import { createTestVolume } from "~/test/helpers/volume";
import { repositoriesService } from "../repositories.service";

let session: Awaited<ReturnType<typeof createTestSession>>;

beforeAll(async () => {
	session = await createTestSession();
});

const inOrganization = <T>(callback: () => Promise<T>, organizationId = session.organizationId) =>
	withContext({ organizationId, userId: session.user.id }, callback);

const insertAgentRepository = async (agentId: string, organizationId: string) => {
	const shortId = generateShortId();
	const [repository] = await db
		.insert(repositoriesTable)
		.values({
			id: Bun.randomUUIDv7(),
			shortId,
			name: `Agent repository ${shortId}`,
			type: "local",
			agentId,
			config: { backend: "local", path: "backups", trustedRootId: "disk" },
			status: "healthy",
			organizationId,
		})
		.returning();

	return repository;
};

const createMachine = async (organizationId: string, name: string) => {
	const { agent } = await agentsService.createRemoteAgent(organizationId, name);
	await db
		.update(agentsTable)
		.set({
			capabilities: {
				trustedRoots: [
					{ id: "disk", label: "Backup disk", canBackup: false, canStoreRepository: true },
					{ id: "photos", label: "Photos", canBackup: true, canStoreRepository: false },
				],
			},
		})
		.where(eq(agentsTable.id, agent.id));

	return agent;
};

const localConfig: RepositoryConfig = { backend: "local", path: "/srv/backups" };
const agentConfig: RepositoryConfig = { backend: "local", path: "backups", trustedRootId: "disk" };

beforeEach(() => {
	vi.spyOn(resticDeps, "getOrganizationResticPassword").mockResolvedValue("encrypted-password");
	vi.spyOn(resticDeps, "resolveSecret").mockResolvedValue("password");
	vi.spyOn(agentManager, "isAgentReady").mockReturnValue(true);
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe("agent-owned repositories", () => {
	test("creates a repository in a unique subdirectory of the chosen location and initializes it there", async () => {
		const machine = await createMachine(session.organizationId, "Warehouse");
		const runCommand = vi
			.spyOn(agentManager, "runResticCommand")
			.mockReturnValue(Effect.succeed({ success: true, error: null }) as never);

		const result = await inOrganization(() =>
			repositoriesService.createRepository("Warehouse repository", agentConfig, undefined, undefined, machine.id),
		);

		expect(result.repository).toMatchObject({
			agentId: machine.id,
			agentName: "Warehouse",
			type: "local",
			config: { trustedRootId: "disk", path: `backups/${result.repository.shortId}` },
		});
		expect(runCommand).toHaveBeenCalledWith(
			machine.id,
			expect.objectContaining({
				command: expect.objectContaining({ name: "restic.init" }),
				repositoryConfig: expect.objectContaining({
					trustedRootId: "disk",
					path: `backups/${result.repository.shortId}`,
				}),
			}),
		);
	});

	test("a repository directly in the location's root gets only the unique subdirectory", async () => {
		const machine = await createMachine(session.organizationId, "Root");
		vi.spyOn(agentManager, "runResticCommand").mockReturnValue(
			Effect.succeed({ success: true, error: null }) as never,
		);

		const result = await inOrganization(() =>
			repositoriesService.createRepository(
				"Root repository",
				{ ...agentConfig, path: "." },
				undefined,
				undefined,
				machine.id,
			),
		);

		expect(result.repository.config).toMatchObject({ trustedRootId: "disk", path: result.repository.shortId });
	});

	test("rejects locations that are missing, do not allow repositories, or escape their root", async () => {
		const machine = await createMachine(session.organizationId, "Picky");
		const create = (config: RepositoryConfig) =>
			inOrganization(() =>
				repositoriesService.createRepository("Picky", config, undefined, undefined, machine.id),
			);

		await expect(create(localConfig)).rejects.toThrow("Choose a location on the machine that allows repositories.");
		await expect(create({ ...agentConfig, trustedRootId: "unknown" })).rejects.toThrow("not advertised");
		await expect(create({ ...agentConfig, trustedRootId: "photos" })).rejects.toThrow(
			"This location does not allow repositories",
		);
		await expect(create({ ...agentConfig, path: "../elsewhere" })).rejects.toThrow("cannot traverse");
		await expect(create({ ...agentConfig, path: "/srv/backups" })).rejects.toThrow("must be relative");
	});

	test("repositories on this server cannot name a machine location", async () => {
		await expect(inOrganization(() => repositoriesService.createRepository("Server", agentConfig))).rejects.toThrow(
			"Repositories on this server use an absolute path, not a trusted root.",
		);
	});

	test("does not keep the repository when the machine rejects initialization", async () => {
		const machine = await createMachine(session.organizationId, "Strict");
		vi.spyOn(agentManager, "runResticCommand").mockReturnValue(
			Effect.fail(new Error('Trusted root "disk" does not allow repositories')) as never,
		);

		await expect(
			inOrganization(() =>
				repositoriesService.createRepository(
					"Rejected repository",
					agentConfig,
					undefined,
					undefined,
					machine.id,
				),
			),
		).rejects.toThrow("does not allow repositories");

		const remaining = await db.query.repositoriesTable.findMany({ where: { agentId: machine.id } });
		expect(remaining).toEqual([]);
	});

	test("keeps repositories created without a machine on this server", async () => {
		vi.spyOn(restic, "init").mockReturnValue(Effect.succeed({ success: true, error: null }) as never);

		const result = await inOrganization(() =>
			repositoriesService.createRepository("Server repository", localConfig),
		);

		expect(result.repository).toMatchObject({ agentId: "local", agentName: null });
	});

	test("rejects machines that are unknown, belong to another organization, or are revoked", async () => {
		const other = await createTestSession();
		const foreign = await createMachine(other.organizationId, "Foreign");
		const revoked = await createMachine(session.organizationId, "Revoked");
		await agentsService.revokeRemoteAgentToken(session.organizationId, revoked.id);

		await expect(
			inOrganization(() =>
				repositoriesService.createRepository("Unknown", localConfig, undefined, undefined, "missing"),
			),
		).rejects.toThrow("Machine not found");
		await expect(
			inOrganization(() =>
				repositoriesService.createRepository("Foreign", localConfig, undefined, undefined, foreign.id),
			),
		).rejects.toThrow("Machine not found");
		await expect(
			inOrganization(() =>
				repositoriesService.createRepository("Revoked", localConfig, undefined, undefined, revoked.id),
			),
		).rejects.toThrow("Machine is revoked");
	});

	test("only local repositories can be stored on another machine", async () => {
		const machine = await createMachine(session.organizationId, "Lab");
		// Only the backend discriminant is read before the check rejects; the rest of the config is never used.
		const restConfig = { backend: "rest", url: "https://rest.example.test" } as RepositoryConfig;

		await expect(
			inOrganization(() =>
				repositoriesService.createRepository("Rest", restConfig, undefined, undefined, machine.id),
			),
		).rejects.toThrow("Only local repositories can be stored on another machine.");
	});

	test("refuses to create a repository on a machine that is offline", async () => {
		const machine = await createMachine(session.organizationId, "Sleepy");
		vi.spyOn(agentManager, "isAgentReady").mockReturnValue(false);

		await expect(
			inOrganization(() =>
				repositoriesService.createRepository(
					"Sleepy repository",
					agentConfig,
					undefined,
					undefined,
					machine.id,
				),
			),
		).rejects.toThrow("offline");
	});

	test("dump and dev-panel restic commands are not available for repositories on another machine", async () => {
		const machine = await createMachine(session.organizationId, "Lab");
		const repository = await insertAgentRepository(machine.id, session.organizationId);

		await expect(
			inOrganization(() => repositoriesService.dumpSnapshot(repository.shortId, "snapshot-1")),
		).rejects.toThrow("not available for repositories stored on another machine");
		await expect(
			inOrganization(() =>
				repositoriesService.execResticCommand(
					repository.shortId,
					"stats",
					undefined,
					() => {},
					() => {},
				),
			),
		).rejects.toThrow("not available for repositories stored on another machine");
	});

	test("restores run on the machine that stores the repository", async () => {
		const machine = await createMachine(session.organizationId, "Studio");
		const repository = await insertAgentRepository(machine.id, session.organizationId);
		const snapshot = {
			id: "snapshot-1",
			short_id: "snapshot-1",
			time: new Date().toISOString(),
			paths: ["/srv/photos"],
			hostname: "studio",
		};

		vi.spyOn(agentManager, "runResticCommand").mockImplementation(((
			_agentId: string,
			request: { command: { name: string } },
		) =>
			Effect.succeed(
				request.command.name === "restic.snapshots" ? [snapshot] : { success: true, error: null },
			)) as never);
		const startRestore = vi
			.spyOn(agentManager, "startRestore")
			.mockResolvedValue({ status: "started", result: new Promise(() => {}) });

		const restore = await inOrganization(() =>
			repositoriesService.restoreSnapshot(repository.shortId, "snapshot-1", { targetPath: REPOSITORY_BASE }),
		);

		expect(restore).toEqual({ restoreId: expect.any(String), status: "started" });
		await vi.waitFor(() =>
			expect(startRestore).toHaveBeenCalledWith(
				machine.id,
				expect.objectContaining({
					payload: expect.objectContaining({ repositoryId: repository.shortId, target: REPOSITORY_BASE }),
				}),
			),
		);
	});
});

describe("restoring on machines that back up to a repository", () => {
	const restConfig: RepositoryConfig = { backend: "rest", url: "https://rest.example.test/repo" };

	const createRemoteSchedule = async (agentId: string, repositoryId: string) => {
		const volume = await createTestVolume({
			organizationId: session.organizationId,
			agentId,
			sourceKind: "filesystem",
			config: null,
			type: null,
			trustedRootId: "photos",
			relativePath: "family",
		});

		return createTestBackupSchedule({ organizationId: session.organizationId, repositoryId, volumeId: volume.id });
	};

	const mockSnapshot = (tags: string[]) => {
		vi.spyOn(restic, "snapshots").mockReturnValue(
			Effect.succeed([
				{
					id: "snapshot-1",
					short_id: "snapshot-1",
					time: new Date().toISOString(),
					paths: ["/data/photos/family"],
					tags,
					hostname: "nas",
				},
			]),
		);

		return vi
			.spyOn(agentManager, "startRestore")
			.mockResolvedValue({ status: "started", result: new Promise(() => {}) });
	};

	test("lists the repository's machine first, then only active machines with a backup job using it", async () => {
		const repository = await createTestRepository({
			organizationId: session.organizationId,
			type: "rest",
			config: restConfig,
		});
		const nas = await createMachine(session.organizationId, "NAS");
		const revoked = await createMachine(session.organizationId, "Retired");
		await createMachine(session.organizationId, "Unrelated");
		await createRemoteSchedule(nas.id, repository.id);
		await createRemoteSchedule(revoked.id, repository.id);
		await agentsService.revokeRemoteAgentToken(session.organizationId, revoked.id);

		const machines = await inOrganization(() => repositoriesService.listRestoreMachines(repository.shortId));

		expect(machines).toEqual([
			{ agentId: "local", name: null },
			{ agentId: nas.id, name: "NAS" },
		]);
	});

	test("restores a server repository's snapshot to its original location on the source machine", async () => {
		const repository = await createTestRepository({
			organizationId: session.organizationId,
			type: "rest",
			config: restConfig,
		});
		const nas = await createMachine(session.organizationId, "NAS");
		const schedule = await createRemoteSchedule(nas.id, repository.id);
		const startRestore = mockSnapshot([schedule.shortId]);

		await inOrganization(() =>
			repositoriesService.restoreSnapshot(repository.shortId, "snapshot-1", { targetAgentId: nas.id }),
		);

		await vi.waitFor(() =>
			expect(startRestore).toHaveBeenCalledWith(
				nas.id,
				expect.objectContaining({
					payload: expect.objectContaining({
						target: "/",
						repositoryConfig: expect.objectContaining({ backend: "rest" }),
						options: expect.objectContaining({ basePath: "/data/photos/family" }),
					}),
				}),
			),
		);
	});

	test("original location on a machine requires the snapshot's source to be on that machine", async () => {
		const repository = await createTestRepository({
			organizationId: session.organizationId,
			type: "rest",
			config: restConfig,
		});
		const nas = await createMachine(session.organizationId, "NAS");
		await createRemoteSchedule(nas.id, repository.id);
		const serverSchedule = await createTestBackupSchedule({
			organizationId: session.organizationId,
			repositoryId: repository.id,
		});
		const startRestore = mockSnapshot([serverSchedule.shortId]);

		await expect(
			inOrganization(() =>
				repositoriesService.restoreSnapshot(repository.shortId, "snapshot-1", { targetAgentId: nas.id }),
			),
		).rejects.toThrow("only available for snapshots of sources on that machine");

		await inOrganization(() =>
			repositoriesService.restoreSnapshot(repository.shortId, "snapshot-1", {
				targetAgentId: nas.id,
				targetPath: "/data/restored",
			}),
		);
		await vi.waitFor(() =>
			expect(startRestore).toHaveBeenCalledWith(
				nas.id,
				expect.objectContaining({ payload: expect.objectContaining({ target: "/data/restored" }) }),
			),
		);
	});

	test("refuses machines without a backup job using the repository and machines the repository is not reachable from", async () => {
		const restRepository = await createTestRepository({
			organizationId: session.organizationId,
			type: "rest",
			config: restConfig,
		});
		const serverLocalRepository = await createTestRepository({ organizationId: session.organizationId });
		const studio = await createMachine(session.organizationId, "Studio");
		const agentRepository = await insertAgentRepository(studio.id, session.organizationId);
		const stranger = await createMachine(session.organizationId, "Stranger");
		// Inserted directly: creating these jobs through the API is rejected because the machine cannot reach the repository.
		await createRemoteSchedule(stranger.id, serverLocalRepository.id);
		await createRemoteSchedule(stranger.id, agentRepository.id);
		const startRestore = mockSnapshot([]);

		for (const repository of [restRepository, serverLocalRepository, agentRepository]) {
			await expect(
				inOrganization(() =>
					repositoriesService.restoreSnapshot(repository.shortId, "snapshot-1", {
						targetAgentId: stranger.id,
						targetPath: "/data/restored",
					}),
				),
			).rejects.toThrow("on a machine with a backup job using it");
		}
		expect(startRestore).not.toHaveBeenCalled();
	});

	test("refuses to restore on a machine that is offline", async () => {
		const repository = await createTestRepository({
			organizationId: session.organizationId,
			type: "rest",
			config: restConfig,
		});
		const nas = await createMachine(session.organizationId, "NAS");
		await createRemoteSchedule(nas.id, repository.id);
		vi.spyOn(agentManager, "isAgentReady").mockReturnValue(false);
		const startRestore = mockSnapshot([]);

		await expect(
			inOrganization(() =>
				repositoriesService.restoreSnapshot(repository.shortId, "snapshot-1", {
					targetAgentId: nas.id,
					targetPath: "/data/restored",
				}),
			),
		).rejects.toThrow("offline");
		expect(startRestore).not.toHaveBeenCalled();
	});
});
