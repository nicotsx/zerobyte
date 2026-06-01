import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { Effect } from "effect";
import type { RepositoryConfig } from "@zerobyte/core/restic";
import { expect, test } from "vitest";
import {
	INTEGRATION_ORGANIZATION_ID,
	INTEGRATION_RUNS_DIR,
	RCLONE_REMOTE,
	RUSTFS_ACCESS_KEY_ID,
	RUSTFS_BUCKET,
	RUSTFS_ENDPOINT,
	RUSTFS_SECRET_ACCESS_KEY,
} from "./constants";
import { assertRestoredFixture, assertSnapshotContainsFixture } from "./helpers/assertions";
import { createScenarioFixture } from "./helpers/fixture";
import { createIntegrationRestic } from "./helpers/restic";

type RepositoryScenario = {
	id: string;
	name: string;
	createRepositoryConfig: (prefix: string) => RepositoryConfig;
};

const scenarios: RepositoryScenario[] = [
	{
		id: "direct-s3",
		name: "direct S3 repository",
		createRepositoryConfig: (prefix) => ({
			backend: "s3",
			endpoint: RUSTFS_ENDPOINT,
			bucket: `${RUSTFS_BUCKET}/${prefix}`,
			accessKeyId: RUSTFS_ACCESS_KEY_ID,
			secretAccessKey: RUSTFS_SECRET_ACCESS_KEY,
		}),
	},
	{
		id: "rclone-s3",
		name: "rclone repository over RustFS S3",
		createRepositoryConfig: (prefix) => ({
			backend: "rclone",
			remote: RCLONE_REMOTE,
			path: `${RUSTFS_BUCKET}/${prefix}`,
		}),
	},
];

test.concurrent.each(scenarios)("$name can backup, list, and restore fixture data", async (scenario) => {
	const runId = crypto.randomUUID();
	const repositoryPrefix = `${scenario.id}/${runId}`;
	const workspace = path.join(INTEGRATION_RUNS_DIR, `${scenario.id}-${runId}`);
	const restoreTarget = path.join(workspace, "restore");
	const backupTag = `zerobyte-integration-${scenario.id}-${runId}`;
	const resticPassword = `zerobyte-integration-${scenario.id}-${runId}-${crypto.randomBytes(16).toString("hex")}`;
	const repositoryConfig = scenario.createRepositoryConfig(repositoryPrefix);
	const restic = createIntegrationRestic(workspace, resticPassword);

	let passed = false;

	try {
		await fs.mkdir(workspace, { recursive: true });
		const fixture = await createScenarioFixture(workspace, scenario.id);

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

		await Effect.runPromise(
			restic.restore(repositoryConfig, snapshotId, restoreTarget, {
				organizationId: INTEGRATION_ORGANIZATION_ID,
				basePath: fixture.sourceRoot,
			}),
		);
		await assertRestoredFixture(restoreTarget, fixture);

		passed = true;
	} finally {
		if (passed) {
			await fs.rm(workspace, { recursive: true, force: true });
		} else {
			console.error(`Integration scenario artifacts retained in ${workspace}`);
		}
	}
});
