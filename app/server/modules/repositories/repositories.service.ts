import * as os from "node:os";
import nodePath from "node:path";
import { and, eq } from "drizzle-orm";
import {
	BadRequestError,
	ConflictError,
	InternalServerError,
	NotFoundError,
	ServiceUnavailableError,
} from "http-errors-enhanced";
import {
	type CompressionMode,
	type OverwriteMode,
	type RepositoryConfig,
	type ResticDumpStream,
	repositoryConfigSchema,
} from "@zerobyte/core/restic";
import { isPathWithin } from "@zerobyte/core/utils";
import { config as appConfig } from "~/server/core/config";
import { DATABASE_URL, RESTORE_BLOCKED_ROOTS, RESTIC_PASS_FILE } from "~/server/core/constants";
import { serverEvents } from "~/server/core/events";
import { getOrganizationId } from "~/server/core/request-context";
import { logger } from "@zerobyte/core/node";
import { parseRetentionCategories, type RetentionCategory } from "~/server/utils/retention-categories";
import { repoMutex } from "../../core/repository-mutex";
import { db } from "../../db/db";
import { repositoriesTable, type RepositoryInsert } from "../../db/schema";
import { cache, cacheKeys } from "../../utils/cache";
import { runEffectPromise, toMessage } from "../../utils/errors";
import { generateShortId } from "../../utils/id";
import { addCommonArgs, buildEnv, buildRepoUrl, cleanupTemporaryKeys } from "@zerobyte/core/restic/server";
import { restic, resticDeps } from "../../core/restic";
import { safeSpawn } from "@zerobyte/core/node";
import type { DumpPathKind, UpdateRepositoryBody } from "./repositories.dto";
import { findCommonAncestor } from "@zerobyte/core/utils";
import { prepareSnapshotDump } from "./helpers/dump";
import { emptyRepositoryStats, refreshStoredRepositoryStats } from "./helpers/repository-stats";
import { asShortId, type ShortId } from "~/server/utils/branded";
import {
	decryptRepositoryConfig,
	encryptRepositoryConfig,
	prepareRepositoryConfigUpdate,
} from "./repository-config-secrets";
import { presentRepositories, presentRepository } from "./repository-presentation";
import { commands } from "./commands";
import { getScheduleByIdOrShortId } from "../backups/helpers/backup-schedule-lookups";
import { taskStore } from "../tasks/tasks.store";
import { Effect, Semaphore } from "effect";
import { normalizeRequiredName } from "~/server/utils/names";
import { bandwidthFields } from "./repository-bandwidth-fields";
import { assertAgentOnline, resticForAgent } from "./repository-restic";
import { isAgentRepository } from "@zerobyte/contracts/backup-context";
import { normalizeTrustedSourceRelativePath, trustedRootAllows } from "@zerobyte/contracts/volumes";
import type { Agent } from "../../db/schema";
import { serverHasRuntimeFeature } from "~/server/lib/permission-service";
import { LOCAL_AGENT_ID } from "../agents/constants";
import { listRestoreMachines, resolveRestoreMachine } from "./helpers/restore-machines";

const lsLimiters = new Map<string, Semaphore.Semaphore>();
const RESTORE_TASK_RESOURCE_TYPE = "repository";
const ORIGINAL_LOCATION_RESTORE_MACHINE_MESSAGE =
	"Original location restore on another machine is only available for snapshots of sources on that machine. Restore to a custom location instead.";

const getBlockedRestoreTargets = () => {
	return [
		...RESTORE_BLOCKED_ROOTS,
		DATABASE_URL === ":memory:" ? undefined : nodePath.dirname(nodePath.resolve(DATABASE_URL)),
		nodePath.dirname(nodePath.resolve(RESTIC_PASS_FILE)),
		nodePath.resolve(os.tmpdir()),
		appConfig.provisioningPath ? nodePath.dirname(nodePath.resolve(appConfig.provisioningPath)) : undefined,
	].filter((e) => e !== undefined);
};

const assertAllowedControllerLocalRestoreTarget = (target: string) => {
	const resolvedTarget = nodePath.resolve(target);

	for (const blockedTarget of getBlockedRestoreTargets()) {
		if (isPathWithin(blockedTarget, resolvedTarget)) {
			throw new BadRequestError(
				"Restore target path is not allowed. Restoring to this path could overwrite critical system files or application data.",
			);
		}
	}
};

const getLsLimiter = (repositoryId: string) => {
	let limiter = lsLimiters.get(repositoryId);
	if (!limiter) {
		limiter = Effect.runSync(Semaphore.make(2));
		lsLimiters.set(repositoryId, limiter);
	}
	return limiter;
};

const findActiveRestoreTask = (organizationId: string, repositoryShortId: string, snapshotId: string) => {
	return taskStore.findActiveByResource({
		organizationId,
		kind: "restore",
		resourceType: RESTORE_TASK_RESOURCE_TYPE,
		resourceId: repositoryShortId,
		operationKey: snapshotId,
	});
};

const findActiveDoctorTask = (organizationId: string, repositoryShortId: string) => {
	return taskStore.findActiveByResource({
		organizationId,
		kind: "doctor",
		resourceType: "repository",
		resourceId: repositoryShortId,
	});
};

const assertOriginalLocationRestoreAllowed = async (
	organizationId: string,
	restoreAgentId: string,
	snapshotTags?: string[] | null,
) => {
	const restoresOnAnotherMachine = restoreAgentId !== LOCAL_AGENT_ID;

	if (!snapshotTags?.length) {
		if (restoresOnAnotherMachine) throw new BadRequestError(ORIGINAL_LOCATION_RESTORE_MACHINE_MESSAGE);
		return;
	}

	const scheduleShortIds = snapshotTags.map(asShortId);
	const schedules = await db.query.backupSchedulesTable.findMany({
		where: {
			AND: [{ shortId: { in: scheduleShortIds } }, { organizationId }],
		},
		with: { volume: true },
	});
	const hasReadOnlySourceVolume = schedules.some((schedule) => schedule.volume?.config?.readOnly === true);

	if (hasReadOnlySourceVolume) {
		throw new BadRequestError(
			"Original location restore is unavailable because the source volume is read-only. Restore to a custom location instead.",
		);
	}

	const sourcesOnRestoreMachine =
		schedules.length > 0 && schedules.every((schedule) => schedule.volume?.agentId === restoreAgentId);
	if (restoresOnAnotherMachine && !sourcesOnRestoreMachine) {
		throw new BadRequestError(ORIGINAL_LOCATION_RESTORE_MACHINE_MESSAGE);
	}
};
const findRepository = async (shortId: ShortId) => {
	const organizationId = getOrganizationId();
	return await db.query.repositoriesTable.findFirst({
		where: {
			AND: [{ shortId: { eq: shortId } }, { organizationId }],
		},
	});
};

const listRepositories = async () => {
	const organizationId = getOrganizationId();
	const repositories = await db.query.repositoriesTable.findMany({ where: { organizationId } });

	return presentRepositories(repositories);
};

const listRestoreMachinesForRepository = async (shortId: ShortId) => {
	const repository = await findRepository(shortId);
	if (!repository) throw new NotFoundError("Repository not found");

	return listRestoreMachines(getOrganizationId(), repository);
};

const findRepositoryAgent = async (
	organizationId: string,
	backend: RepositoryConfig["backend"],
	agentId: string,
): Promise<Agent | null> => {
	if (agentId === LOCAL_AGENT_ID) return null;

	if (backend !== "local") {
		throw new BadRequestError("Only local repositories can be stored on another machine.");
	}

	if (!serverHasRuntimeFeature("remoteAgents")) {
		throw new ServiceUnavailableError("Remote agents are disabled on this instance.");
	}

	const agent = await db.query.agentsTable.findFirst({
		where: { AND: [{ id: agentId }, { kind: "remote" }, { organizationId }] },
	});

	if (!agent) throw new NotFoundError("Machine not found");
	if (agent.revokedAt !== null) throw new BadRequestError("Machine is revoked");

	return agent;
};

/**
 * A local repository on this server is an absolute path. On another machine it is one of that machine's trusted roots
 * that allows repositories plus a path relative to it ("." for the root itself); the agent resolves the real path, so
 * this server never learns where the root lives. `uniqueSubdirectory` is appended for newly initialized repositories.
 */
const prepareRepositoryLocation = (
	agent: Agent | null,
	config: RepositoryConfig,
	uniqueSubdirectory: string | null,
): RepositoryConfig => {
	if (config.backend !== "local") return config;

	if (!agent) {
		if (config.trustedRootId !== undefined) {
			throw new BadRequestError("Repositories on this server use an absolute path, not a trusted root.");
		}

		return uniqueSubdirectory ? { ...config, path: `${config.path}/${uniqueSubdirectory}` } : config;
	}

	if (config.trustedRootId === undefined) {
		throw new BadRequestError("Choose a location on the machine that allows repositories.");
	}

	const root = agent.capabilities.trustedRoots?.find((candidate) => candidate.id === config.trustedRootId);
	if (!root) throw new BadRequestError(`Location "${config.trustedRootId}" is not advertised by the machine`);
	if (!trustedRootAllows(root, "repository")) {
		throw new BadRequestError(
			'This location does not allow repositories ("allowRepository": true in ZEROBYTE_AGENT_ROOTS on the machine)',
		);
	}

	let relativePath: string;
	try {
		relativePath = normalizeTrustedSourceRelativePath(config.path);
	} catch (error) {
		throw new BadRequestError(toMessage(error));
	}

	const path = [relativePath, uniqueSubdirectory].filter(Boolean).join("/");
	return { ...config, path: path || "." };
};

const createRepository = async (
	name: string,
	config: RepositoryConfig,
	compressionMode?: CompressionMode,
	autoCheckEnabled?: boolean,
	agentId: string = LOCAL_AGENT_ID,
) => {
	const organizationId = getOrganizationId();
	const normalizedName = normalizeRequiredName(name);

	if (normalizedName === null) {
		throw new BadRequestError("Repository name cannot be empty");
	}

	const agent = await findRepositoryAgent(organizationId, config.backend, agentId);
	assertAgentOnline(agentId);

	const id = Bun.randomUUIDv7();
	const shortId = generateShortId();
	const resolvedCompressionMode = compressionMode ?? "auto";
	const resolvedAutoCheckEnabled = autoCheckEnabled ?? true;
	const bandwidth = bandwidthFields(config);
	const location = prepareRepositoryLocation(agent, config, config.isExistingRepository ? null : shortId);

	const encryptedConfig = await encryptRepositoryConfig(location);

	const [created] = await db
		.insert(repositoriesTable)
		.values({
			id,
			shortId,
			name: normalizedName,
			type: config.backend,
			agentId,
			config: encryptedConfig,
			compressionMode: resolvedCompressionMode,
			autoCheckEnabled: resolvedAutoCheckEnabled,
			status: "unknown",
			...bandwidth,
			organizationId,
		})
		.returning();

	if (!created) {
		throw new InternalServerError("Failed to create repository");
	}

	const resticOps = resticForAgent(agentId);
	let error: unknown = null;

	try {
		if (location.isExistingRepository) {
			await runEffectPromise(resticOps.snapshots(encryptedConfig, { organizationId }));
		} else {
			const initResult = await runEffectPromise(resticOps.init(encryptedConfig, { organizationId }));
			error = initResult.error;
		}
	} catch (caught) {
		// Rejections (e.g. the machine refusing the path or going offline) must not leave a half-created repository.
		error = caught;
	}

	if (!error) {
		await db
			.update(repositoriesTable)
			.set({ status: "healthy", lastChecked: Date.now(), lastError: null })
			.where(and(eq(repositoriesTable.id, id), eq(repositoriesTable.organizationId, organizationId)));

		return {
			repository: await presentRepository(created),
			status: 201,
		};
	}

	const errorMessage = toMessage(error);
	await db
		.delete(repositoriesTable)
		.where(and(eq(repositoriesTable.id, id), eq(repositoriesTable.organizationId, organizationId)));

	throw new InternalServerError(`Failed to initialize repository: ${errorMessage}`);
};

const getRepository = async (shortId: ShortId) => {
	const repository = await findRepository(shortId);

	if (!repository) {
		throw new NotFoundError("Repository not found");
	}

	return { repository: await presentRepository(repository) };
};

const refreshRepositoryStats = async (shortId: ShortId) => {
	const repository = await findRepository(shortId);

	if (!repository) {
		throw new NotFoundError("Repository not found");
	}

	return refreshStoredRepositoryStats(repository);
};

const getRepositoryStats = async (shortId: ShortId) => {
	const repository = await findRepository(shortId);

	if (!repository) {
		throw new NotFoundError("Repository not found");
	}

	return repository.stats ?? { ...emptyRepositoryStats };
};

const deleteRepository = async (shortId: ShortId) => {
	const repository = await findRepository(shortId);

	if (!repository) {
		throw new NotFoundError("Repository not found");
	}

	// TODO: Add cleanup logic for the actual restic repository files

	await db
		.delete(repositoriesTable)
		.where(
			and(
				eq(repositoriesTable.id, repository.id),
				eq(repositoriesTable.organizationId, repository.organizationId),
			),
		);

	cache.delByPrefix(cacheKeys.repository.all(repository.id));
};

/**
 * List snapshots for a given repository
 * If backupId is provided, filter snapshots by that backup ID (tag)
 * @param shortId Repository short ID
 * @param backupId Optional backup ID to filter snapshots for a specific backup schedule
 *
 * @returns List of snapshots
 */
const listSnapshots = async (shortId: ShortId, backupId?: ShortId) => {
	const organizationId = getOrganizationId();
	const repository = await findRepository(shortId);

	if (!repository) {
		throw new NotFoundError("Repository not found");
	}

	const cacheKey = cacheKeys.repository.snapshots(repository.id, backupId);
	const cached = cache.get<Effect.Success<ReturnType<typeof restic.snapshots>>>(cacheKey);
	if (cached) {
		return cached;
	}

	const releaseLock = await repoMutex.acquireShared(repository.id, "snapshots");
	try {
		let snapshots = [];

		if (backupId) {
			snapshots = await runEffectPromise(
				resticForAgent(repository.agentId).snapshots(repository.config, { tags: [backupId], organizationId }),
			);
		} else {
			snapshots = await runEffectPromise(
				resticForAgent(repository.agentId).snapshots(repository.config, { organizationId }),
			);
		}

		cache.set(cacheKey, snapshots);

		return snapshots;
	} finally {
		releaseLock();
	}
};

const listSnapshotFiles = async (
	shortId: ShortId,
	snapshotId: string,
	path?: string,
	options?: { offset?: number; limit?: number },
) => {
	const organizationId = getOrganizationId();
	const repository = await findRepository(shortId);

	if (!repository) {
		throw new NotFoundError("Repository not found");
	}

	const offset = options?.offset ?? 0;
	const limit = options?.limit ?? 500;

	const cacheKey = cacheKeys.repository.ls(repository.id, snapshotId, path, offset, limit);
	type LsResult = Effect.Success<ReturnType<typeof restic.ls>>;
	const cached = cache.get<LsResult>(cacheKey);
	if (cached?.snapshot) {
		return {
			snapshot: cached.snapshot,
			files: cached.nodes,
			offset: cached.pagination.offset,
			limit: cached.pagination.limit,
			total: cached.pagination.total,
			hasMore: cached.pagination.hasMore,
		};
	}

	const limiter = getLsLimiter(repository.id);
	await runEffectPromise(limiter.take(1));

	try {
		const releaseLock = await repoMutex.acquireShared(repository.id, `ls:${snapshotId}`);
		try {
			const result = await runEffectPromise(
				resticForAgent(repository.agentId).ls(repository.config, snapshotId, path, {
					organizationId,
					offset,
					limit,
				}),
			);

			if (!result.snapshot) {
				throw new NotFoundError("Snapshot not found or empty");
			}

			const response = {
				snapshot: {
					id: result.snapshot.id,
					short_id: result.snapshot.short_id,
					time: result.snapshot.time,
					hostname: result.snapshot.hostname,
					paths: result.snapshot.paths,
				},
				files: result.nodes,
				offset: result.pagination.offset,
				limit: result.pagination.limit,
				total: result.pagination.total,
				hasMore: result.pagination.hasMore,
			};

			cache.set(cacheKey, result);

			return response;
		} finally {
			releaseLock();
		}
	} finally {
		await runEffectPromise(limiter.release(1));
	}
};

const restoreSnapshot = async (
	shortId: ShortId,
	snapshotId: string,
	options?: {
		include?: string[];
		selectedItemKind?: "file" | "dir";
		exclude?: string[];
		excludeXattr?: string[];
		delete?: boolean;
		targetPath?: string;
		overwrite?: OverwriteMode;
		targetAgentId?: string;
	},
) => {
	const organizationId = getOrganizationId();
	const repository = await findRepository(shortId);

	if (!repository) {
		throw new NotFoundError("Repository not found");
	}

	const { targetPath, targetAgentId, ...restoreExecutionOptions } = options ?? {};
	const restoreAgentId = await resolveRestoreMachine(organizationId, repository, targetAgentId);
	assertAgentOnline(restoreAgentId);

	const target = targetPath || "/";
	// The agent and restic treat exactly "/" as the original location, and path resolution would turn it into a drive
	// root on a Windows server.
	const restoresToOriginalLocation = target === "/";

	const snapshot = await getSnapshotDetails(repository.shortId, snapshotId);
	const hasNonPosixSnapshotPaths = snapshot.paths.some((path) => !path.startsWith("/"));

	if (restoresToOriginalLocation) {
		await assertOriginalLocationRestoreAllowed(organizationId, restoreAgentId, snapshot.tags);
	}

	if (hasNonPosixSnapshotPaths && restoresToOriginalLocation) {
		throw new BadRequestError(
			"Original location restore is unavailable for this snapshot. Restore it to a custom location instead.",
		);
	}

	const basePath = hasNonPosixSnapshotPaths ? "/" : findCommonAncestor(snapshot.paths);
	if (restoreAgentId === LOCAL_AGENT_ID) assertAllowedControllerLocalRestoreTarget(target);

	const activeRestore = findActiveRestoreTask(organizationId, repository.shortId, snapshotId);
	if (activeRestore) {
		throw new ConflictError("A restore is already running for this snapshot");
	}

	const repositoryConfig = await decryptRepositoryConfig(repository.config);
	const command = commands.createRestore({
		organizationId,
		repositoryId: repository.id,
		repositoryShortId: repository.shortId,
		agentId: restoreAgentId,
		repositoryName: repository.name,
		repositoryConfig,
		snapshotId,
		target,
		options: {
			basePath,
			...restoreExecutionOptions,
		},
	});

	return command.start();
};
const dumpSnapshot = async (shortId: ShortId, snapshotId: string, path?: string, kind?: DumpPathKind) => {
	const organizationId = getOrganizationId();
	const repository = await findRepository(shortId);

	if (!repository) {
		throw new NotFoundError("Repository not found");
	}

	if (isAgentRepository(repository)) {
		throw new BadRequestError("Snapshot download is not available for repositories stored on another machine.");
	}

	const releaseLock = await repoMutex.acquireShared(repository.id, `dump:${snapshotId}`);
	let dumpStream: ResticDumpStream | null = null;

	try {
		const snapshot = await getSnapshotDetails(repository.shortId, snapshotId);
		const preparedDump = prepareSnapshotDump({
			snapshotId,
			snapshotPaths: snapshot.paths,
			requestedPath: path,
		});
		const dumpOptions: Parameters<typeof restic.dump>[2] = {
			organizationId,
			path: preparedDump.path,
		};

		let filename = preparedDump.filename;
		let contentType = "application/x-tar";

		if (path && preparedDump.path !== "/") {
			if (!kind) {
				throw new BadRequestError("Path kind is required when downloading a specific snapshot path");
			}

			if (kind === "file") {
				dumpOptions.archive = false;
				contentType = "application/octet-stream";
				const fileName = nodePath.posix.basename(preparedDump.path);
				if (fileName) {
					filename = fileName;
				}
			}
		}

		dumpStream = await runEffectPromise(restic.dump(repository.config, preparedDump.snapshotRef, dumpOptions));

		serverEvents.emit("dump:started", {
			organizationId,
			repositoryId: repository.shortId,
			snapshotId,
			path: preparedDump.path,
			filename,
		});

		const completion = dumpStream.completion.finally(releaseLock);
		void completion.catch(() => {});

		return { ...dumpStream, completion, filename, contentType };
	} catch (error) {
		if (dumpStream) {
			dumpStream.abort();
		}
		releaseLock();
		throw error;
	}
};

const getSnapshotDetails = async (shortId: ShortId, snapshotId: string) => {
	const organizationId = getOrganizationId();
	const repository = await findRepository(shortId);

	if (!repository) {
		throw new NotFoundError("Repository not found");
	}

	const cacheKey = cacheKeys.repository.snapshots(repository.id);
	let snapshots = cache.get<Effect.Success<ReturnType<typeof restic.snapshots>>>(cacheKey);

	if (!snapshots) {
		const releaseLock = await repoMutex.acquireShared(repository.id, `snapshot_details:${snapshotId}`);
		try {
			snapshots = await runEffectPromise(
				resticForAgent(repository.agentId).snapshots(repository.config, { organizationId }),
			);
			cache.set(cacheKey, snapshots);
		} finally {
			releaseLock();
		}
	}

	const snapshot = snapshots.find((snap) => snap.id === snapshotId || snap.short_id === snapshotId);

	if (!snapshot) {
		void refreshSnapshots(shortId).catch(() => {});

		throw new NotFoundError("Snapshot not found");
	}

	return snapshot;
};

const checkHealth = async (shortId: ShortId) => {
	const organizationId = getOrganizationId();
	const repository = await findRepository(shortId);

	if (!repository) {
		throw new NotFoundError("Repository not found");
	}

	const releaseLock = await repoMutex.acquireExclusive(repository.id, "check");
	try {
		const { hasErrors, error } = await runEffectPromise(
			resticForAgent(repository.agentId).check(repository.config, { organizationId }),
		);

		await db
			.update(repositoriesTable)
			.set({
				status: hasErrors ? "error" : "healthy",
				lastChecked: Date.now(),
				lastError: error,
			})
			.where(
				and(
					eq(repositoriesTable.id, repository.id),
					eq(repositoriesTable.organizationId, repository.organizationId),
				),
			);

		return { lastError: error };
	} finally {
		releaseLock();
	}
};

const startDoctor = async (shortId: ShortId) => {
	const organizationId = getOrganizationId();
	const repository = await findRepository(shortId);

	if (!repository) {
		throw new NotFoundError("Repository not found");
	}

	assertAgentOnline(repository.agentId);

	const activeDoctorTask = findActiveDoctorTask(organizationId, repository.shortId);
	if (activeDoctorTask) {
		throw new ConflictError("Doctor operation already in progress");
	}

	const command = commands.createDoctor({ repository });
	return command.start();
};

const deleteSnapshot = async (shortId: ShortId, snapshotId: string) => {
	return deleteSnapshots(shortId, [snapshotId]);
};

const deleteSnapshots = async (shortId: ShortId, snapshotIds: string[]) => {
	const repository = await findRepository(shortId);

	if (!repository) {
		throw new NotFoundError("Repository not found");
	}

	assertAgentOnline(repository.agentId);

	const command = commands.createDeleteSnapshots({
		repository,
		snapshotIds,
	});

	return command.start();
};

const tagSnapshots = async (
	shortId: ShortId,
	snapshotIds: string[],
	tags: { add?: string[]; remove?: string[]; set?: string[] },
) => {
	const repository = await findRepository(shortId);

	if (!repository) {
		throw new NotFoundError("Repository not found");
	}

	assertAgentOnline(repository.agentId);

	const command = commands.createTagSnapshots({
		repository,
		snapshotIds,
		tags,
	});

	return command.start();
};

const refreshSnapshots = async (shortId: ShortId) => {
	const organizationId = getOrganizationId();
	const repository = await findRepository(shortId);

	if (!repository) {
		throw new NotFoundError("Repository not found");
	}

	cache.delByPrefix(cacheKeys.repository.all(repository.id));

	const releaseLock = await repoMutex.acquireShared(repository.id, "refresh");
	try {
		const snapshots = await runEffectPromise(
			resticForAgent(repository.agentId).snapshots(repository.config, { organizationId }),
		);
		const cacheKey = cacheKeys.repository.snapshots(repository.id);
		cache.set(cacheKey, snapshots);

		return {
			message: "Snapshot cache cleared and refreshed",
			count: snapshots.length,
		};
	} finally {
		releaseLock();
	}
};

const updateRepository = async (shortId: ShortId, updates: UpdateRepositoryBody) => {
	const existing = await findRepository(shortId);

	if (!existing) {
		throw new NotFoundError("Repository not found");
	}

	const configResult = repositoryConfigSchema.safeParse(updates.config ?? existing.config);
	if (!configResult.success) {
		if (updates.config) throw new BadRequestError("Invalid repository configuration");
		throw new InternalServerError("Invalid repository configuration");
	}
	let parsedConfig = configResult.data;
	if (parsedConfig.backend !== existing.type) {
		throw new BadRequestError("Repository backend cannot be changed");
	}

	const existingConfig = repositoryConfigSchema.safeParse(existing.config).data ?? existing.config;

	if (updates.config && parsedConfig.backend === "local" && existingConfig.backend === "local") {
		const locationChanged =
			parsedConfig.path !== existingConfig.path || parsedConfig.trustedRootId !== existingConfig.trustedRootId;

		if (locationChanged) {
			const agent = await findRepositoryAgent(existing.organizationId, parsedConfig.backend, existing.agentId);
			parsedConfig = prepareRepositoryLocation(agent, parsedConfig, null);
		}
	}

	let newName = existing.name;
	if (updates.name !== undefined) {
		const normalizedName = normalizeRequiredName(updates.name);

		if (normalizedName === null) {
			throw new BadRequestError("Repository name cannot be empty");
		}

		newName = normalizedName;
	}

	const preparedConfig = updates.config
		? await prepareRepositoryConfigUpdate(existingConfig, parsedConfig)
		: { config: existingConfig, changed: false };
	const encryptedConfig = preparedConfig.config;
	const configChanged = preparedConfig.changed;
	const resolvedCompressionMode = updates.compressionMode ?? existing.compressionMode;
	const resolvedAutoCheckEnabled = updates.autoCheckEnabled ?? existing.autoCheckEnabled;
	const bandwidth = bandwidthFields(parsedConfig);
	const updatedAt = Date.now();
	const updatePayload: Partial<RepositoryInsert> = {
		name: newName,
		compressionMode: resolvedCompressionMode,
		autoCheckEnabled: resolvedAutoCheckEnabled,
		updatedAt,
		config: encryptedConfig,
		...bandwidth,
	};

	if (configChanged) {
		updatePayload.status = "unknown";
		updatePayload.lastChecked = null;
		updatePayload.lastError = null;
		updatePayload.doctorResult = null;
		updatePayload.stats = null;
		updatePayload.statsUpdatedAt = null;
	}

	const [updated] = await db
		.update(repositoriesTable)
		.set(updatePayload)
		.where(
			and(eq(repositoriesTable.id, existing.id), eq(repositoriesTable.organizationId, existing.organizationId)),
		)
		.returning();

	if (!updated) {
		throw new InternalServerError("Failed to update repository");
	}

	if (configChanged) {
		cache.delByPrefix(cacheKeys.repository.all(existing.id));
	}

	return { repository: await presentRepository(updated) };
};

const unlockRepository = async (shortId: ShortId) => {
	const organizationId = getOrganizationId();
	const repository = await findRepository(shortId);

	if (!repository) {
		throw new NotFoundError("Repository not found");
	}

	const releaseLock = await repoMutex.acquireExclusive(repository.id, "unlock");
	try {
		const result = await runEffectPromise(
			resticForAgent(repository.agentId).unlock(repository.config, { organizationId }),
		);
		return result;
	} finally {
		releaseLock();
	}
};

const execResticCommand = async (
	shortId: ShortId,
	command: string,
	args: string[] | undefined,
	onStdout: (line: string) => void,
	onStderr: (line: string) => void,
	signal?: AbortSignal,
) => {
	const organizationId = getOrganizationId();
	const repository = await findRepository(shortId);

	if (!repository) {
		throw new NotFoundError("Repository not found");
	}

	if (isAgentRepository(repository)) {
		throw new BadRequestError("Restic commands are not available for repositories stored on another machine.");
	}

	const repoUrl = buildRepoUrl(repository.config);
	const env = await buildEnv(repository.config, organizationId, resticDeps);

	const resticArgs: string[] = ["--repo", repoUrl, command];
	if (args && args.length > 0) {
		resticArgs.push(...args);
	}
	addCommonArgs(resticArgs, env, repository.config);

	try {
		const result = await safeSpawn({
			command: "restic",
			args: resticArgs,
			env,
			signal,
			onStdout,
			onStderr,
		});
		return { exitCode: result.exitCode };
	} finally {
		await cleanupTemporaryKeys(env, resticDeps);
	}
};

const getRetentionCategories = async (repositoryId: ShortId, scheduleId?: ShortId) => {
	if (!scheduleId) {
		return new Map<string, RetentionCategory[]>();
	}

	try {
		const repository = await findRepository(repositoryId);
		if (!repository) {
			return new Map<string, RetentionCategory[]>();
		}

		const cacheKey = cacheKeys.repository.retention(repository.id, scheduleId);
		const cached = cache.get<Record<string, RetentionCategory[]>>(cacheKey);

		if (cached) {
			return new Map(Object.entries(cached));
		}

		const schedule = await getScheduleByIdOrShortId(scheduleId);

		if (!schedule?.retentionPolicy) {
			return new Map<string, RetentionCategory[]>();
		}

		const dryRunResults = await runEffectPromise(
			resticForAgent(repository.agentId).forget(repository.config, schedule.retentionPolicy, {
				tag: scheduleId,
				organizationId: getOrganizationId(),
				dryRun: true,
			}),
		);

		if (!dryRunResults.data) {
			return new Map<string, RetentionCategory[]>();
		}

		const categories = parseRetentionCategories(dryRunResults.data);
		cache.set(cacheKey, Object.fromEntries(categories));

		return categories;
	} catch (error) {
		logger.error(`Failed to get retention categories: ${toMessage(error)}`);
		return new Map<string, RetentionCategory[]>();
	}
};

export const repositoriesService = {
	listRepositories,
	createRepository,
	getRepository,
	getRepositoryStats,
	refreshRepositoryStats,
	deleteRepository,
	updateRepository,
	listSnapshots,
	listSnapshotFiles,
	restoreSnapshot,
	listRestoreMachines: listRestoreMachinesForRepository,
	dumpSnapshot,
	getSnapshotDetails,
	checkHealth,
	startDoctor,
	deleteSnapshot,
	deleteSnapshots,
	tagSnapshots,
	refreshSnapshots,
	execResticCommand,
	getRetentionCategories,
	unlockRepository,
};
