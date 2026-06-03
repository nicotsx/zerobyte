import { logger, safeExec } from "../node";
import { toMessage } from "../utils";
import { safeJsonParse } from "../utils/json";
import { ResticLockError } from "./error";
import { addCommonArgs } from "./helpers/add-common-args";
import { buildEnv } from "./helpers/build-env";
import { buildRepoUrl } from "./helpers/build-repo-url";
import { cleanupTemporaryKeys } from "./helpers/cleanup-temporary-keys";
import type { RepositoryConfig } from "./schemas";
import type { ResticDeps } from "./types";

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
	if (error instanceof ResticLockError) {
		return true;
	}

	const message = toMessage(error);
	return LOCK_ERROR_PATTERNS.some((pattern) => pattern.test(message));
};

const RESTIC_LOCK_ID_PATTERN = /^[a-f0-9]{64}$/i;

const addLockId = (ids: Set<string>, candidate: unknown) => {
	if (typeof candidate === "string" && RESTIC_LOCK_ID_PATTERN.test(candidate)) {
		ids.add(candidate);
	}
};

const parseLockIds = (stdout: string) => {
	const ids = new Set<string>();

	for (const line of stdout.split("\n")) {
		const trimmed = line.trim();
		if (!trimmed) continue;

		const parsed = safeJsonParse<{ id?: unknown }>(trimmed);
		if (parsed) {
			addLockId(ids, parsed.id);
			continue;
		}

		addLockId(ids, trimmed);
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
				args: [...baseArgs, "cat", "lock", "--", lockId],
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
		const configsByRepoUrl = new Map(
			[repositoryConfig, ...relatedRepositoryConfigs].map((config) => [buildRepoUrl(config), config]),
		);
		const configsToInspect = [...configsByRepoUrl.entries()];

		logger.error("[ResticLockFailure] Restic repository lock failure detected", {
			operation,
			error: toMessage(error),
			process: {
				pid: process.pid,
				hostname: process.env.HOSTNAME,
				nodeEnv: process.env.NODE_ENV,
			},
			repository: {
				repoUrl: buildRepoUrl(repositoryConfig),
			},
			relatedRepositories: relatedRepositoryConfigs.map((config) => ({
				repoUrl: buildRepoUrl(config),
			})),
		});

		for (const [repoUrl, config] of configsToInspect) {
			try {
				const resticLocks = await inspectResticLocks(config, organizationId, resticDeps);
				logger.error("[ResticLockFailure] Restic backend lock dump", {
					operation,
					repoUrl,
					resticLocks,
				});
			} catch (diagnosticError) {
				logger.error("[ResticLockFailure] Failed to inspect restic backend locks", {
					operation,
					repoUrl,
					error: toMessage(diagnosticError),
				});
			}
		}

		return true;
	} catch (diagnosticError) {
		logger.error("[ResticLockFailure] Failed to collect lock diagnostics", {
			operation,
			repoUrl: buildRepoUrl(repositoryConfig),
			error: toMessage(diagnosticError),
		});
		return true;
	}
};
