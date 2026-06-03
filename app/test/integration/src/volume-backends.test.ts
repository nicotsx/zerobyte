import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { RepositoryConfig } from "@zerobyte/core/restic";
import { Effect } from "effect";
import { expect, test } from "vitest";
import { makeNfsBackend } from "../../../../apps/agent/src/volume-host/backends/nfs";
import { makeSmbBackend } from "../../../../apps/agent/src/volume-host/backends/smb";
import { makeSftpBackend } from "../../../../apps/agent/src/volume-host/backends/sftp";
import { makeWebdavBackend } from "../../../../apps/agent/src/volume-host/backends/webdav";
import type { VolumeBackend } from "../../../../apps/agent/src/volume-host/types";
import { INTEGRATION_ORGANIZATION_ID, INTEGRATION_RUNS_DIR } from "./constants";
import { assertFixtureSourceExists, assertRestoredFixture, assertSnapshotContainsFixture } from "./helpers/assertions";
import { createStaticVolumeFixture } from "./helpers/fixture";
import { buildNfsVolumeConfig } from "./helpers/nfs";
import { createIntegrationRestic } from "./helpers/restic";
import {
	buildSftpPasswordVolumeConfig,
	buildSftpPrivateKeyVolumeConfig,
	readSftpPrivateKey,
	scanSftpKnownHosts,
} from "./helpers/sftp";
import { buildSmbVolumeConfig } from "./helpers/smb";
import { buildWebdavVolumeConfig } from "./helpers/webdav";

type VolumeScenario = {
	id: string;
	name: string;
	createBackend: (mountPath: string) => Promise<VolumeBackend>;
};

const scenarios: VolumeScenario[] = [
	{
		id: "sftp-local-repo",
		name: "SFTP volume with private key auth and local repository",
		createBackend: async (mountPath) => {
			const knownHosts = await scanSftpKnownHosts();
			const privateKey = await readSftpPrivateKey();
			const config = buildSftpPrivateKeyVolumeConfig({ privateKey, knownHosts });
			return makeSftpBackend(config, mountPath);
		},
	},
	{
		id: "sftp-password-local-repo",
		name: "SFTP volume with password auth and local repository",
		createBackend: async (mountPath) => {
			const knownHosts = await scanSftpKnownHosts();
			const config = buildSftpPasswordVolumeConfig({ knownHosts });
			return makeSftpBackend(config, mountPath);
		},
	},
	{
		id: "webdav-local-repo",
		name: "WebDAV volume with local repository",
		createBackend: async (mountPath) => makeWebdavBackend(buildWebdavVolumeConfig(), mountPath),
	},
	{
		id: "smb-local-repo",
		name: "SMB volume with local repository",
		createBackend: async (mountPath) => makeSmbBackend(buildSmbVolumeConfig(), mountPath),
	},
	{
		id: "nfs-local-repo",
		name: "NFS volume with local repository",
		createBackend: async (mountPath) => makeNfsBackend(buildNfsVolumeConfig(), mountPath),
	},
];

const volumeMountTest = process.env.SKIP_VOLUME_MOUNT_INTEGRATION_TESTS === "true" ? test.skip : test;

const makeDirectoriesWritable = async (root: string): Promise<void> => {
	await fs.chmod(root, 0o700).catch(() => {});

	const entries = await fs.readdir(root, { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => {
		if (error.code === "ENOENT") return [];
		throw error;
	});

	await Promise.all(
		entries.map(async (entry) => {
			if (entry.isDirectory()) {
				await makeDirectoriesWritable(path.join(root, entry.name));
			}
		}),
	);
};

volumeMountTest.concurrent.each(scenarios)("$name can backup and restore static fixture data", async (scenario) => {
	const runId = crypto.randomUUID();
	const workspace = path.join(INTEGRATION_RUNS_DIR, `${scenario.id}-${runId}`);
	const mountPath = path.join(workspace, "mount");
	const repositoryPath = path.join(workspace, "repo");
	const restoreTarget = path.join(workspace, "restore");
	const backupTag = `zerobyte-integration-${scenario.id}-${runId}`;
	const resticPassword = `zerobyte-integration-${scenario.id}-${runId}-${crypto.randomBytes(16).toString("hex")}`;
	const repositoryConfig: RepositoryConfig = { backend: "local", path: repositoryPath };
	const restic = createIntegrationRestic(workspace, resticPassword);

	let backend: VolumeBackend | undefined;
	let passed = false;
	let unmountFailed = false;
	let cleanupError: Error | undefined;

	try {
		await fs.mkdir(workspace, { recursive: true });

		const initResult = await Effect.runPromise(
			restic.init(repositoryConfig, {
				organizationId: INTEGRATION_ORGANIZATION_ID,
				timeoutMs: 120_000,
			}),
		);
		expect(initResult.success).toBe(true);
		expect(initResult.error).toBeNull();

		backend = await scenario.createBackend(mountPath);

		const mountResult = await backend.mount();
		expect(mountResult.status).toBe("mounted");

		const healthResult = await backend.checkHealth();
		expect(healthResult.status).toBe("mounted");

		const fixture = createStaticVolumeFixture(path.join(mountPath, "case-a"));
		await assertFixtureSourceExists(fixture);

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
				console.error(`Failed to unmount ${scenario.id} volume at ${mountPath}: ${unmountResult.error}`);
			}
		}

		if (passed && !unmountFailed) {
			await makeDirectoriesWritable(workspace);
			await fs.rm(workspace, { recursive: true, force: true });
		} else {
			console.error(`Integration scenario artifacts retained in ${workspace}`);
		}

		if (passed && unmountFailed) {
			cleanupError = new Error(`Failed to unmount ${scenario.id} volume at ${mountPath}`);
		}
	}

	if (cleanupError) {
		throw cleanupError;
	}
});
