import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { Effect } from "effect";
import type { VolumeBackend } from "../../../apps/agent/src/volume-host/types";
import { makeDirectoryBackend } from "../../../apps/agent/src/volume-host/backends/directory";
import { makeNfsBackend } from "../../../apps/agent/src/volume-host/backends/nfs";
import { makeRcloneBackend } from "../../../apps/agent/src/volume-host/backends/rclone";
import { makeSftpBackend } from "../../../apps/agent/src/volume-host/backends/sftp";
import { makeSmbBackend } from "../../../apps/agent/src/volume-host/backends/smb";
import { makeWebdavBackend } from "../../../apps/agent/src/volume-host/backends/webdav";
import { createRestic } from "@zerobyte/core/restic/server";
import { RCLONE_CONFIG_FILE } from "~/server/core/constants";
import { configSchema, type IntegrationScenario } from "./runner/config";
import {
	formatError,
	logScenario,
	printRunSummary,
	type IntegrationReport,
	type ScenarioReport,
	type StageReport,
} from "./runner/reporting";
import { verifyFilesystemEntries, verifySnapshotEntries } from "./runner/verification";

const WORKDIR_ROOT = "/tmp/zerobyte-integration";
const INTEGRATION_ORGANIZATION_ID = "backend-integration";

function createVolumeBackend(config: IntegrationScenario["volume"], mountPath: string): VolumeBackend {
	switch (config.backend) {
		case "nfs":
			return makeNfsBackend(config, mountPath);
		case "smb":
			return makeSmbBackend(config, mountPath);
		case "directory":
			return makeDirectoryBackend(config, mountPath);
		case "webdav":
			return makeWebdavBackend(config, mountPath);
		case "rclone":
			return makeRcloneBackend(config, mountPath);
		case "sftp":
			return makeSftpBackend(config, mountPath);
	}
}

function createResticSession(scenarioWorkspace: string): {
	organizationId: string;
	client: ReturnType<typeof createRestic>;
} {
	const password = crypto.randomBytes(32).toString("hex");
	const cacheDir = path.join(scenarioWorkspace, "restic-cache");
	const passFile = path.join(scenarioWorkspace, "restic.pass");

	return {
		organizationId: INTEGRATION_ORGANIZATION_ID,
		client: createRestic({
			resolveSecret: async (value: string) => value,
			getOrganizationResticPassword: async () => password,
			resticCacheDir: cacheDir,
			resticPassFile: passFile,
			defaultExcludes: [],
			rcloneConfigFile: RCLONE_CONFIG_FILE,
		}),
	};
}

async function runStage<T>(stages: StageReport[], name: string, fn: () => Promise<T>): Promise<T> {
	const startedAt = Date.now();

	try {
		const result = await fn();
		stages.push({
			name,
			status: "passed",
			durationMs: Date.now() - startedAt,
		});
		return result;
	} catch (error) {
		stages.push({
			name,
			status: "failed",
			durationMs: Date.now() - startedAt,
			error: formatError(error),
		});
		throw error;
	}
}

async function mountBackend(backend: VolumeBackend) {
	const mountResult = await backend.mount();
	if (mountResult.status !== "mounted") {
		throw new Error(mountResult.error ?? `Mount returned ${mountResult.status}`);
	}

	const healthResult = await backend.checkHealth();
	if (healthResult.status !== "mounted") {
		throw new Error(healthResult.error ?? `Health check returned ${healthResult.status}`);
	}
}

async function backupSnapshot(
	resticClient: ReturnType<typeof createRestic>,
	repositoryConfig: IntegrationScenario["repository"],
	fixtureRootPath: string,
	organizationId: string,
	backupOptions: IntegrationScenario["backup"],
	uniqueBackupTag: string,
) {
	const execution = await Effect.runPromise(
		resticClient.backup(repositoryConfig, fixtureRootPath, {
			organizationId,
			compressionMode: backupOptions?.compressionMode,
			customResticParams: backupOptions?.customResticParams,
			tags: [...(backupOptions?.tags ?? []), uniqueBackupTag],
		}),
	);

	if (execution.exitCode !== 0) {
		throw new Error(`restic backup returned exit code ${execution.exitCode}`);
	}

	if (!execution.result?.snapshot_id) {
		throw new Error("restic backup completed without a snapshot id");
	}

	if (execution.warningDetails) {
		throw new Error(`restic backup reported warnings: ${execution.warningDetails}`);
	}

	return execution.result.snapshot_id;
}

async function verifySnapshot(
	resticClient: ReturnType<typeof createRestic>,
	repositoryConfig: IntegrationScenario["repository"],
	organizationId: string,
	snapshotId: string,
	uniqueBackupTag: string,
	fixtureRootPath: string,
	scenario: IntegrationScenario,
) {
	const snapshots = await Effect.runPromise(
		resticClient.snapshots(repositoryConfig, {
			organizationId,
			tags: [uniqueBackupTag],
		}),
	);

	const snapshot = snapshots.find((candidate) => candidate.id === snapshotId || candidate.short_id === snapshotId);
	if (!snapshot) {
		throw new Error(`Unable to find snapshot ${snapshotId} by integration tag ${uniqueBackupTag}`);
	}

	const res = await Effect.runPromise(resticClient.ls(repositoryConfig, snapshotId, undefined, { organizationId }));

	await verifySnapshotEntries(fixtureRootPath, res.nodes, scenario.expectedEntries);
}

async function restoreSnapshot(
	resticClient: ReturnType<typeof createRestic>,
	repositoryConfig: IntegrationScenario["repository"],
	snapshotId: string,
	restoreTarget: string,
	organizationId: string,
	fixtureRootPath: string,
	restoreOptions: IntegrationScenario["restore"],
) {
	await fs.mkdir(restoreTarget, { recursive: true });
	await Effect.runPromise(
		resticClient.restore(repositoryConfig, snapshotId, restoreTarget, {
			organizationId,
			basePath: fixtureRootPath,
			excludeXattr: restoreOptions?.excludeXattr,
			overwrite: restoreOptions?.overwrite,
		}),
	);
}

async function cleanupScenario(backend: VolumeBackend, restoreTarget: string, scenarioWorkspace: string) {
	const cleanupErrors: string[] = [];
	const unmountResult = await backend.unmount();
	const didUnmount = unmountResult.status !== "error";

	if (!didUnmount) {
		cleanupErrors.push(unmountResult.error ?? `Unmount returned ${unmountResult.status}`);
	}

	await fs.rm(restoreTarget, { recursive: true, force: true }).catch((error) => {
		cleanupErrors.push(`Failed to remove restore target: ${formatError(error)}`);
	});

	if (didUnmount) {
		await fs.rm(scenarioWorkspace, { recursive: true, force: true }).catch((error) => {
			cleanupErrors.push(`Failed to remove scenario workspace: ${formatError(error)}`);
		});
	}

	if (cleanupErrors.length > 0) {
		throw new Error(cleanupErrors.join("; "));
	}
}

async function runScenario(scenario: IntegrationScenario, runId: string): Promise<ScenarioReport> {
	const startedAt = Date.now();
	const stages: StageReport[] = [];
	const scenarioWorkspace = path.join(WORKDIR_ROOT, `${scenario.id}-${runId}`);
	const mountPath = path.join(scenarioWorkspace, "volume", "_data");
	const restoreTarget = path.join(scenarioWorkspace, "restore");

	const uniqueBackupTag = `zerobyte-integration-${scenario.id}-${runId}`;
	const { client: resticClient, organizationId } = createResticSession(scenarioWorkspace);
	const backend = createVolumeBackend(scenario.volume, mountPath);

	let snapshotId = "";
	let status: ScenarioReport["status"] = "passed";
	let errorMessage: string | undefined;

	await fs.mkdir(scenarioWorkspace, { recursive: true });
	logScenario(scenario.id, "running...");

	try {
		await runStage(stages, "mount", async () => {
			await mountBackend(backend);
		});

		const fixtureRootPath = path.resolve(mountPath, scenario.fixtureRoot);
		await runStage(stages, "verify-mounted-source", async () => {
			await verifyFilesystemEntries(fixtureRootPath, scenario.expectedEntries, "mounted source");
		});

		await runStage(stages, "init-repository", async () => {
			if (scenario.repository.isExistingRepository) return;

			const initResult = await Effect.runPromise(resticClient.init(scenario.repository, { organizationId }));
			if (!initResult.success) {
				throw new Error(initResult.error ?? "restic init failed");
			}
		});

		snapshotId = await runStage(stages, "backup", async () => {
			return await backupSnapshot(
				resticClient,
				scenario.repository,
				fixtureRootPath,
				organizationId,
				scenario.backup,
				uniqueBackupTag,
			);
		});

		if (!snapshotId) {
			throw new Error("restic backup completed without a snapshot id");
		}

		await runStage(stages, "inspect-snapshot", async () => {
			await verifySnapshot(
				resticClient,
				scenario.repository,
				organizationId,
				snapshotId,
				uniqueBackupTag,
				fixtureRootPath,
				scenario,
			);
		});

		await runStage(stages, "restore", async () => {
			await restoreSnapshot(
				resticClient,
				scenario.repository,
				snapshotId,
				restoreTarget,
				organizationId,
				fixtureRootPath,
				scenario.restore,
			);
		});

		await runStage(stages, "verify-restore", async () => {
			await verifyFilesystemEntries(restoreTarget, scenario.expectedEntries, "restored output");
		});
	} catch (error) {
		status = "failed";
		errorMessage = formatError(error);
		logScenario(scenario.id, `failed: ${errorMessage}`);
	} finally {
		try {
			await runStage(stages, "cleanup", async () => {
				await cleanupScenario(backend, restoreTarget, scenarioWorkspace);
			});
		} catch (error) {
			status = "failed";
			const cleanupError = formatError(error);

			if (!errorMessage) {
				errorMessage = cleanupError;
				logScenario(scenario.id, `failed: ${cleanupError}`);
			} else {
				logScenario(scenario.id, `cleanup failed: ${cleanupError}`);
			}
		}
	}

	if (status === "passed") {
		logScenario(scenario.id, "passed");
	}

	return {
		id: scenario.id,
		volumeBackend: scenario.volume.backend,
		repositoryBackend: scenario.repository.backend,
		status,
		durationMs: Date.now() - startedAt,
		stages,
		snapshotId,
		error: errorMessage,
	};
}

export async function runBackendIntegration(): Promise<void> {
	const runStartedAt = Date.now();
	const runId = crypto.randomBytes(6).toString("hex");

	await fs.mkdir(WORKDIR_ROOT, { recursive: true });

	const content = await fs.readFile("/config/config.json", "utf8");
	const { scenarios } = configSchema.parse(JSON.parse(content));

	process.stdout.write(
		`Running ${scenarios.length} integration scenario${scenarios.length === 1 ? "" : "s"} (run ${runId})\n`,
	);

	const scenarioReports: ScenarioReport[] = [];
	for (const scenario of scenarios) {
		scenarioReports.push(await runScenario(scenario, runId));
	}

	const passed = scenarioReports.filter((scenario) => scenario.status === "passed").length;
	const failed = scenarioReports.length - passed;
	const report: IntegrationReport = {
		runId,
		startedAt: new Date(runStartedAt).toISOString(),
		finishedAt: new Date().toISOString(),
		durationMs: Date.now() - runStartedAt,
		passed,
		failed,
		scenarios: scenarioReports,
	};

	printRunSummary(report);

	if (failed > 0) {
		process.exitCode = 1;
	}
}
