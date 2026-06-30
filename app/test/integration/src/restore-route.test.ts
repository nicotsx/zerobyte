import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { eq } from "drizzle-orm";
import { Effect } from "effect";
import { beforeAll, expect, test } from "vitest";
import waitForExpect from "wait-for-expect";
import { OVERWRITE_MODES, type OverwriteMode, type RepositoryConfig } from "@zerobyte/core/restic";
import { organization, repositoriesTable, tasksTable } from "~/server/db/schema";
import { generateShortId } from "~/server/utils/id";
import { INTEGRATION_RUNS_DIR } from "./constants";
import { createIntegrationRestic } from "./helpers/restic";

process.env.NODE_ENV = "test";
process.env.APP_SECRET = "8b9acd4456dd5db0a4a3c4f4e1240b2c3ae08bb59690167197425e4a25dd9a69";
process.env.BASE_URL = "http://localhost:4096";
process.env.TRUSTED_ORIGINS = "http://localhost:4096";
process.env.ZEROBYTE_DATABASE_URL = ":memory:";
process.env.ENABLE_LOCAL_AGENT = "false";
process.env.RESTIC_CACHE_DIR = path.join(os.tmpdir(), "zerobyte-integration-server-restic-cache");
process.env.RESTIC_PASS_FILE = path.join(os.tmpdir(), "zerobyte-integration-server-restic.pass");

type RestoreLocation = "original" | "custom";
type ConflictAge = "old" | "newer";

type SelectionScenario = {
	id: string;
	name: string;
	include: (sourceRoot: string) => string[] | undefined;
	selectedItemKind?: "file" | "dir";
	selectedFiles: Record<string, string>;
	conflicts: Partial<Record<string, ConflictAge>>;
	missing: string[];
};

type RestoreMatrixCase = {
	name: string;
	selection: SelectionScenario;
	location: RestoreLocation;
	overwrite: OverwriteMode;
};

let app: ReturnType<typeof import("~/server/app").createApp>;
let db: (typeof import("~/server/db/db"))["db"];
let cryptoUtils: typeof import("~/server/utils/crypto").cryptoUtils;
let session: Awaited<ReturnType<typeof import("~/test/helpers/auth").createTestSession>>;

const resticPassword = `restore-route-${crypto.randomBytes(16).toString("hex")}`;
const snapshotTime = new Date("2025-01-01T00:00:00.000Z");
const oldTime = new Date("2024-01-01T00:00:00.000Z");
const newerTime = new Date("2026-01-01T00:00:00.000Z");

const allFiles = [
	"top.txt",
	"folder-a/a.txt",
	"folder-a/deep/deep.txt",
	"folder-b/b.txt",
	"folder-c/keep.txt",
] as const;

const snapshotContent = (relativePath: string) => `snapshot:${relativePath}\n`;
const currentContent = (caseId: string, relativePath: string) => `current:${caseId}:${relativePath}\n`;

beforeAll(async () => {
	const database = await import("~/server/db/db");
	await database.runDbMigrations();

	db = database.db;
	({ cryptoUtils } = await import("~/server/utils/crypto"));

	const { createApp } = await import("~/server/app");
	const { createTestSession } = await import("~/test/helpers/auth");
	app = createApp();
	session = await createTestSession();

	await db
		.update(organization)
		.set({ metadata: { resticPassword: await cryptoUtils.sealSecret(resticPassword) } })
		.where(eq(organization.id, session.organizationId));
});

const writeFile = async (filePath: string, content: string, mtime = snapshotTime) => {
	await fs.mkdir(path.dirname(filePath), { recursive: true });
	await fs.writeFile(filePath, content);
	await fs.utimes(filePath, mtime, mtime);
};

const createFixture = async (sourceRoot: string) => {
	for (const relativePath of allFiles) {
		await writeFile(path.join(sourceRoot, relativePath), snapshotContent(relativePath));
	}
};

const directoryExists = async (directory: string) => {
	try {
		await fs.stat(directory);
		return true;
	} catch (error) {
		if ((error as { code?: string }).code === "ENOENT") {
			return false;
		}

		throw error;
	}
};

const removeDirectory = async (directory: string) => {
	const deadline = Date.now() + 40_000;
	let missingSince: number | null = null;

	while (Date.now() < deadline) {
		if (await directoryExists(directory)) {
			missingSince = null;
			await fs.rm(directory, { recursive: true, force: true });
		} else {
			missingSince ??= Date.now();
			if (Date.now() - missingSince >= 2_000) {
				return;
			}
		}

		await delay(100);
	}

	throw new Error(`Failed to remove ${directory}`);
};

const selections: SelectionScenario[] = [
	{
		id: "restore-all",
		name: "restore all",
		include: () => undefined,
		selectedFiles: Object.fromEntries(allFiles.map((relativePath) => [relativePath, relativePath])),
		conflicts: {
			"top.txt": "old",
			"folder-a/a.txt": "newer",
		},
		missing: ["folder-b/b.txt"],
	},
	{
		id: "single-file",
		name: "single selected file",
		include: (sourceRoot) => [path.join(sourceRoot, "folder-a/deep/deep.txt")],
		selectedItemKind: "file",
		selectedFiles: {
			"folder-a/deep/deep.txt": "deep.txt",
		},
		conflicts: {
			"folder-a/deep/deep.txt": "old",
		},
		missing: [],
	},
	{
		id: "single-dir",
		name: "single selected directory",
		include: (sourceRoot) => [path.join(sourceRoot, "folder-a")],
		selectedItemKind: "dir",
		selectedFiles: {
			"folder-a/a.txt": "a.txt",
			"folder-a/deep/deep.txt": "deep/deep.txt",
		},
		conflicts: {
			"folder-a/a.txt": "old",
			"folder-a/deep/deep.txt": "newer",
		},
		missing: [],
	},
	{
		id: "multi-depth",
		name: "multiple selected items at different depths",
		include: (sourceRoot) => [
			path.join(sourceRoot, "top.txt"),
			path.join(sourceRoot, "folder-a/deep/deep.txt"),
			path.join(sourceRoot, "folder-b"),
		],
		selectedFiles: {
			"top.txt": "top.txt",
			"folder-a/deep/deep.txt": "folder-a/deep/deep.txt",
			"folder-b/b.txt": "folder-b/b.txt",
		},
		conflicts: {
			"top.txt": "old",
			"folder-b/b.txt": "newer",
		},
		missing: ["folder-a/deep/deep.txt"],
	},
];

const overwriteModes = [
	OVERWRITE_MODES.always,
	OVERWRITE_MODES.ifChanged,
	OVERWRITE_MODES.ifNewer,
	OVERWRITE_MODES.never,
];

const restoreCases: RestoreMatrixCase[] = selections.flatMap((selection) =>
	(["original", "custom"] as const).flatMap((location) =>
		overwriteModes.map((overwrite) => ({
			name: `${selection.name} to ${location} location with ${overwrite} overwrite`,
			selection,
			location,
			overwrite,
		})),
	),
);

const prepareDestination = async (testCase: RestoreMatrixCase, sourceRoot: string, restoreTarget: string) => {
	const destinationRoot = testCase.location === "original" ? sourceRoot : restoreTarget;

	if (testCase.location === "custom") {
		await fs.mkdir(restoreTarget, { recursive: true });
	}

	for (const [sourceRelativePath, destinationRelativePath] of Object.entries(testCase.selection.selectedFiles)) {
		const destinationPath =
			testCase.location === "original"
				? path.join(sourceRoot, sourceRelativePath)
				: path.join(destinationRoot, destinationRelativePath);
		const conflictAge = testCase.selection.conflicts[sourceRelativePath];

		if (testCase.selection.missing.includes(sourceRelativePath)) {
			await fs.rm(destinationPath, { force: true });
			continue;
		}

		if (conflictAge) {
			await writeFile(
				destinationPath,
				currentContent(testCase.selection.id, sourceRelativePath),
				conflictAge === "old" ? oldTime : newerTime,
			);
		}
	}

	if (testCase.selection.id !== "restore-all") {
		const unselectedPath = path.join(sourceRoot, "folder-c/keep.txt");
		await writeFile(unselectedPath, currentContent(testCase.selection.id, "folder-c/keep.txt"));
	}
};

const expectedContent = (testCase: RestoreMatrixCase, sourceRelativePath: string) => {
	const conflictAge = testCase.selection.conflicts[sourceRelativePath];

	if (testCase.overwrite === OVERWRITE_MODES.never && conflictAge) {
		return currentContent(testCase.selection.id, sourceRelativePath);
	}

	if (testCase.overwrite === OVERWRITE_MODES.ifNewer && conflictAge === "newer") {
		return currentContent(testCase.selection.id, sourceRelativePath);
	}

	return snapshotContent(sourceRelativePath);
};

test.concurrent.each(restoreCases)(
	"$name",
	async (testCase) => {
		const runId = crypto.randomUUID();
		const workspace = path.join(
			INTEGRATION_RUNS_DIR,
			`restore-route-${testCase.selection.id}-${testCase.location}-${testCase.overwrite}-${runId}`,
		);
		const targetRoot = path.join(
			process.env.HOME ?? path.dirname(INTEGRATION_RUNS_DIR),
			".zerobyte-restore-route-runs",
			runId,
		);
		const sourceRoot = path.join(workspace, "source");
		const restoreTarget = path.join(targetRoot, "restore");
		const repositoryConfig: RepositoryConfig = { backend: "local", path: path.join(workspace, "repo") };
		const restic = createIntegrationRestic(workspace, resticPassword);

		let passed = false;

		try {
			await fs.mkdir(workspace, { recursive: true });
			await createFixture(sourceRoot);

			const initResult = await Effect.runPromise(
				restic.init(repositoryConfig, {
					organizationId: session.organizationId,
					timeoutMs: 120_000,
				}),
			);
			expect(initResult.success).toBe(true);
			expect(initResult.error).toBeNull();

			const backupResult = await Effect.runPromise(
				restic.backup(repositoryConfig, sourceRoot, {
					organizationId: session.organizationId,
					tags: [`restore-route-${runId}`],
				}),
			);
			expect(backupResult.exitCode).toBe(0);
			expect(backupResult.result?.snapshot_id).toEqual(expect.any(String));

			const snapshotId = backupResult.result?.snapshot_id;
			if (!snapshotId) {
				throw new Error("Restic backup completed without a snapshot id");
			}

			const repositoryShortId = generateShortId();
			const [repository] = await db
				.insert(repositoriesTable)
				.values({
					id: crypto.randomUUID(),
					shortId: repositoryShortId,
					name: `Restore route ${runId}`,
					type: "local",
					config: repositoryConfig,
					compressionMode: "auto",
					status: "healthy",
					organizationId: session.organizationId,
				})
				.returning();
			expect(repository).toBeDefined();

			await prepareDestination(testCase, sourceRoot, restoreTarget);

			const response = await app.request(`/api/v1/repositories/${repositoryShortId}/restore`, {
				method: "POST",
				headers: {
					...session.headers,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					snapshotId,
					targetPath: testCase.location === "custom" ? restoreTarget : undefined,
					overwrite: testCase.overwrite,
					include: testCase.selection.include(sourceRoot),
					selectedItemKind: testCase.selection.selectedItemKind,
				}),
			});

			expect(response.status).toBe(202);
			const body = (await response.json()) as { restoreId: string; status: "started" };
			expect(body.status).toBe("started");

			await waitForExpect(async () => {
				const [task] = await db.select().from(tasksTable).where(eq(tasksTable.id, body.restoreId)).limit(1);
				expect(task?.status).toBe("succeeded");
			}, 30_000);

			for (const [sourceRelativePath, destinationRelativePath] of Object.entries(
				testCase.selection.selectedFiles,
			)) {
				const restoredPath =
					testCase.location === "original"
						? path.join(sourceRoot, sourceRelativePath)
						: path.join(restoreTarget, destinationRelativePath);
				await expect(fs.readFile(restoredPath, "utf8")).resolves.toBe(
					expectedContent(testCase, sourceRelativePath),
				);
			}

			if (testCase.selection.id !== "restore-all") {
				await expect(fs.readFile(path.join(sourceRoot, "folder-c/keep.txt"), "utf8")).resolves.toBe(
					currentContent(testCase.selection.id, "folder-c/keep.txt"),
				);
				if (testCase.location === "custom") {
					await expect(fs.stat(path.join(restoreTarget, "folder-c/keep.txt"))).rejects.toMatchObject({
						code: "ENOENT",
					});
				}
			}

			passed = true;
		} finally {
			if (passed) {
				await removeDirectory(workspace);
				if (testCase.location === "custom") {
					await removeDirectory(targetRoot);
					await fs.rmdir(path.dirname(targetRoot)).catch(() => undefined);
				}
			} else {
				console.error(`Restore route integration artifacts retained in ${workspace} and ${targetRoot}`);
			}
		}
	},
	90_000,
);
