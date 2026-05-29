import { logger, safeExec } from "@zerobyte/core/node";
import { ResticError, type RepositoryConfig } from "@zerobyte/core/restic";
import { addCommonArgs, buildEnv, buildRepoUrl, cleanupTemporaryKeys } from "@zerobyte/core/restic/server";
import type { ResticDeps } from "@zerobyte/core/restic";
import { db } from "~/server/db/db";
import { type Repository } from "~/server/db/schema";
import { toMessage } from "~/server/utils/errors";

type ResticLockDiagnosticContext = {
	error: unknown;
	operation: string;
	repositoryConfig: RepositoryConfig;
	organizationId: string;
	resticDeps: ResticDeps;
	relatedRepositoryConfigs?: RepositoryConfig[];
};

const LOCK_ERROR_PATTERNS = [
	/unable to create lock in backend/i,
	/repository is already locked/i,
	/failed to lock repository/i,
	/"code"\s*:\s*11/i,
	/\bexit_error\b.*\b11\b/i,
];

export const isResticLockFailure = (error: unknown) => {
	if (error instanceof ResticError && error.code === 11) {
		return true;
	}

	const message = toMessage(error);
	return LOCK_ERROR_PATTERNS.some((pattern) => pattern.test(message));
};

const physicalRepositoryKey = (config: RepositoryConfig) => {
	switch (config.backend) {
		case "local":
			return `local:${config.path}`;
		case "s3":
		case "r2":
			return `${config.backend}:${config.endpoint.trim().replace(/\/$/, "")}/${config.bucket}`;
		case "gcs":
			return `gcs:${config.bucket}`;
		case "azure":
			return `azure:${config.accountName}/${config.container}`;
		case "rclone":
			return `rclone:${config.remote}:${config.path}`;
		case "rest":
			return `rest:${config.url.trim().replace(/\/$/, "")}/${config.path ?? ""}`;
		case "sftp":
			return `sftp:${config.user}@${config.host}:${config.port ?? 22}:${config.path}`;
	}
};

const getMutexRows = (repositoryIds: string[]) => {
	if (repositoryIds.length === 0) {
		return { locks: [], waiters: [] };
	}

	const locks = db.query.repositoryLocksTable.findMany().sync();
	const waiters = db.query.repositoryLockWaitersTable.findMany().sync();
	const idSet = new Set(repositoryIds);

	return {
		locks: locks.filter((lock) => idSet.has(lock.repositoryId)),
		waiters: waiters.filter((waiter) => idSet.has(waiter.repositoryId)),
	};
};

const findRepositoriesByConfig = (config: RepositoryConfig, organizationId: string) => {
	const target = physicalRepositoryKey(config);
	const repositories = db.query.repositoriesTable
		.findMany({
			where: { organizationId },
		})
		.sync();

	return repositories.filter((candidate) => physicalRepositoryKey(candidate.config) === target);
};

const summarizeRepository = (repository: Repository) => ({
	id: repository.id,
	shortId: repository.shortId,
	name: repository.name,
	type: repository.type,
	status: repository.status,
	physicalKey: physicalRepositoryKey(repository.config),
	repoUrl: buildRepoUrl(repository.config),
	lastChecked: repository.lastChecked,
	lastError: repository.lastError,
});

const listPhysicalDuplicates = (config: RepositoryConfig, organizationId: string) => {
	const repositories = findRepositoriesByConfig(config, organizationId);

	return repositories
		.filter(
			(candidate) =>
				repositories.length > 1 || physicalRepositoryKey(candidate.config) === physicalRepositoryKey(config),
		)
		.map(summarizeRepository);
};

const parseLockIds = (stdout: string) => {
	const ids = new Set<string>();

	for (const line of stdout.split("\n")) {
		const trimmed = line.trim();
		if (!trimmed) continue;

		const jsonId = trimmed.match(/"id"\s*:\s*"([^"]+)"/)?.[1];
		if (jsonId) {
			ids.add(jsonId);
			continue;
		}

		const hexId = trimmed.match(/[a-f0-9]{64}/i)?.[0];
		if (hexId) {
			ids.add(hexId);
		}
	}

	return [...ids].slice(0, 20);
};

const inspectResticLocks = async (config: RepositoryConfig, organizationId: string, deps: ResticDeps) => {
	const repoUrl = buildRepoUrl(config);
	const env = await buildEnv(config, organizationId, deps);
	const baseArgs = ["--repo", repoUrl];
	addCommonArgs(baseArgs, env, config);

	try {
		const listResult = await safeExec({
			command: "restic",
			args: [...baseArgs, "list", "locks"],
			env,
			timeout: 15_000,
		});

		const lockIds = listResult.exitCode === 0 ? parseLockIds(listResult.stdout) : [];
		const lockDetails = [];

		for (const lockId of lockIds) {
			const catResult = await safeExec({
				command: "restic",
				args: [...baseArgs, "cat", "lock", lockId],
				env,
				timeout: 15_000,
			});

			lockDetails.push({
				lockId,
				exitCode: catResult.exitCode,
				stdout: catResult.stdout,
				stderr: catResult.stderr,
				timedOut: catResult.timedOut,
			});
		}

		return {
			repoUrl,
			list: {
				exitCode: listResult.exitCode,
				stdout: listResult.stdout,
				stderr: listResult.stderr,
				timedOut: listResult.timedOut,
			},
			lockIds,
			lockDetails,
		};
	} finally {
		await cleanupTemporaryKeys(env, deps);
	}
};

export const logResticLockFailureDiagnostics = async ({
	error,
	operation,
	repositoryConfig,
	organizationId,
	resticDeps,
	relatedRepositoryConfigs = [],
}: ResticLockDiagnosticContext) => {
	if (!isResticLockFailure(error)) {
		return false;
	}

	try {
		const repositoryRows = findRepositoriesByConfig(repositoryConfig, organizationId);
		const relatedRows = relatedRepositoryConfigs.flatMap((config) =>
			findRepositoriesByConfig(config, organizationId),
		);
		const uniqueRows = [...repositoryRows, ...relatedRows].filter(
			(candidate, index, all) => all.findIndex((other) => other.id === candidate.id) === index,
		);
		const duplicateRows = listPhysicalDuplicates(repositoryConfig, organizationId);
		const repositoryIds = [
			...new Set([...uniqueRows.map((candidate) => candidate.id), ...duplicateRows.map((row) => row.id)]),
		];
		const mutexRows = getMutexRows(repositoryIds);

		logger.error("[ResticLockFailure] Restic repository lock failure detected", {
			operation,
			error: toMessage(error),
			process: {
				pid: process.pid,
				hostname: process.env.HOSTNAME,
				nodeEnv: process.env.NODE_ENV,
			},
			repository: {
				physicalKey: physicalRepositoryKey(repositoryConfig),
				repoUrl: buildRepoUrl(repositoryConfig),
				matchingRows: repositoryRows.map(summarizeRepository),
			},
			relatedRepositories: relatedRows.map(summarizeRepository),
			duplicatePhysicalRepositoryRows: duplicateRows,
			mutexState: mutexRows,
		});

		const configsToInspect = [repositoryConfig, ...relatedRepositoryConfigs].filter(
			(config, index, all) =>
				all.findIndex((other) => physicalRepositoryKey(other) === physicalRepositoryKey(config)) === index,
		);

		for (const config of configsToInspect) {
			try {
				const resticLocks = await inspectResticLocks(config, organizationId, resticDeps);
				logger.error("[ResticLockFailure] Restic backend lock dump", {
					operation,
					physicalKey: physicalRepositoryKey(config),
					resticLocks,
				});
			} catch (diagnosticError) {
				logger.error("[ResticLockFailure] Failed to inspect restic backend locks", {
					operation,
					physicalKey: physicalRepositoryKey(config),
					error: toMessage(diagnosticError),
				});
			}
		}

		return true;
	} catch (diagnosticError) {
		logger.error("[ResticLockFailure] Failed to collect lock diagnostics", {
			operation,
			physicalKey: physicalRepositoryKey(repositoryConfig),
			error: toMessage(diagnosticError),
		});
		return true;
	}
};
