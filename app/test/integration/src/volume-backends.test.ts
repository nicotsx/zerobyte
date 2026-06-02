import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { BackendConfig } from "@zerobyte/contracts/volumes";
import type { RepositoryConfig } from "@zerobyte/core/restic";
import { Effect } from "effect";
import { expect, test } from "vitest";
import { makeSftpBackend } from "../../../../apps/agent/src/volume-host/backends/sftp";
import { INTEGRATION_ORGANIZATION_ID, INTEGRATION_RUNS_DIR } from "./constants";
import { assertFixtureSourceExists, assertRestoredFixture, assertSnapshotContainsFixture } from "./helpers/assertions";
import { createStaticSftpFixture } from "./helpers/fixture";
import { createIntegrationRestic } from "./helpers/restic";
import {
	buildSftpPasswordVolumeConfig,
	buildSftpPrivateKeyVolumeConfig,
	readSftpPrivateKey,
	scanSftpKnownHosts,
} from "./helpers/sftp";

type SftpVolumeScenario = {
	id: string;
	name: string;
	createVolumeConfig: (runtime: { privateKey: string; knownHosts: string }) => BackendConfig;
};

const scenarios: SftpVolumeScenario[] = [
	{
		id: "sftp-local-repo",
		name: "SFTP volume with private key auth and local repository",
		createVolumeConfig: ({ privateKey, knownHosts }) => buildSftpPrivateKeyVolumeConfig({ privateKey, knownHosts }),
	},
	{
		id: "sftp-password-local-repo",
		name: "SFTP volume with password auth and local repository",
		createVolumeConfig: ({ knownHosts }) => buildSftpPasswordVolumeConfig({ knownHosts }),
	},
];

test.concurrent.each(scenarios)("$name can backup and restore static fixture data", async (scenario) => {
	const runId = crypto.randomUUID();
	const workspace = path.join(INTEGRATION_RUNS_DIR, `${scenario.id}-${runId}`);
	const mountPath = path.join(workspace, "mount");
	const repositoryPath = path.join(workspace, "repo");
	const restoreTarget = path.join(workspace, "restore");
	const backupTag = `zerobyte-integration-${scenario.id}-${runId}`;
	const resticPassword = `zerobyte-integration-${scenario.id}-${runId}-${crypto.randomBytes(16).toString("hex")}`;
	const repositoryConfig: RepositoryConfig = { backend: "local", path: repositoryPath };
	const restic = createIntegrationRestic(workspace, resticPassword);

	let backend: ReturnType<typeof makeSftpBackend> | undefined;
	let passed = false;
	let unmountFailed = false;

	try {
		await fs.mkdir(workspace, { recursive: true });

		const knownHosts = await scanSftpKnownHosts();
		const privateKey = await readSftpPrivateKey();
		const volumeConfig = scenario.createVolumeConfig({ privateKey, knownHosts });
		backend = makeSftpBackend(volumeConfig, mountPath);

		const mountResult = await backend.mount();
		expect(mountResult.status).toBe("mounted");

		const healthResult = await backend.checkHealth();
		expect(healthResult.status).toBe("mounted");

		const fixture = createStaticSftpFixture(path.join(mountPath, "case-a"));
		await assertFixtureSourceExists(fixture);

		const initResult = await Effect.runPromise(
			restic.init(repositoryConfig, {
				organizationId: INTEGRATION_ORGANIZATION_ID,
				timeoutMs: 120_000,
			}),
		);
		expect(initResult.success).toBe(true);
		expect(initResult.error).toBeNull();

		const backupResult = await Effect.runPromise(
			restic.backup(repositoryConfig, fixture.sourceRoot, {
				organizationId: INTEGRATION_ORGANIZATION_ID,
				tags: [backupTag],
			}),
		);

		expect(backupResult.exitCode).toBe(0);
		expect(backupResult.warningDetails).toBeNull();
		expect(backupResult.result?.snapshot_id).toEqual(expect.any(String));

		const snapshotId = backupResult.result?.snapshot_id;
		if (!snapshotId) {
			throw new Error("Restic backup completed without a snapshot id");
		}

		const snapshots = await Effect.runPromise(
			restic.snapshots(repositoryConfig, {
				organizationId: INTEGRATION_ORGANIZATION_ID,
				tags: [backupTag],
			}),
		);
		const snapshot = snapshots.find(
			(candidate) => candidate.id === snapshotId || candidate.short_id === snapshotId,
		);
		expect(snapshot).toBeDefined();
		expect(snapshot?.paths).toContain(fixture.sourceRoot);

		const lsResult = await Effect.runPromise(
			restic.ls(repositoryConfig, snapshotId, undefined, {
				organizationId: INTEGRATION_ORGANIZATION_ID,
				limit: 100,
			}),
		);
		assertSnapshotContainsFixture(fixture.sourceRoot, lsResult.nodes, fixture);

		const unmountResult = await backend.unmount();
		expect(unmountResult.status).toBe("unmounted");
		backend = undefined;

		await Effect.runPromise(
			restic.restore(repositoryConfig, snapshotId, restoreTarget, {
				organizationId: INTEGRATION_ORGANIZATION_ID,
				basePath: fixture.sourceRoot,
			}),
		);
		await assertRestoredFixture(restoreTarget, fixture);

		passed = true;
	} finally {
		if (backend) {
			const unmountResult = await backend.unmount();
			if (unmountResult.status === "error") {
				unmountFailed = true;
				console.error(`Failed to unmount SFTP volume at ${mountPath}: ${unmountResult.error}`);
			}
		}

		if (passed && !unmountFailed) {
			await fs.rm(workspace, { recursive: true, force: true });
		} else {
			console.error(`Integration scenario artifacts retained in ${workspace}`);
		}

		if (passed && unmountFailed) {
			throw new Error(`Failed to unmount SFTP volume at ${mountPath}`);
		}
	}
});
