import { beforeEach, expect, test, vi } from "vitest";
import { fromAny } from "@total-typescript/shoehorn";
import { getBackupSchedule } from "~/client/api-client";
import { Route as BackupRestoreRoute } from "~/routes/(dashboard)/backups/$backupId/$snapshotId.restore";
import { Route as RepositoryRestoreRoute } from "~/routes/(dashboard)/repositories/$repositoryId/$snapshotId/restore";

vi.mock("~/client/api-client", () => ({ getBackupSchedule: vi.fn() }));
vi.mock("~/client/modules/repositories/routes/restore-snapshot", () => ({ RestoreSnapshotPage: () => null }));

const snapshot = { paths: ["/documents"], tags: ["backup-1"] };
const repository = { shortId: "repo-1" };

const context = {
	queryClient: {
		ensureQueryData: vi.fn(async (options: { queryKey: unknown[] }) => {
			const operation = (options.queryKey[0] as { _id?: string })._id;
			if (operation === "getSnapshotDetails") return snapshot;
			if (operation === "getRepository") return repository;

			return [];
		}),
	},
};

beforeEach(() => vi.clearAllMocks());

test.each([
	["managed", "local", "local"],
	["agent-filesystem", "local", "local"],
	["agent-filesystem", "remote-machine", "remote"],
])("both restore entry points recognize %s on %s as %s", async (sourceKind, agentId, sourceOrigin) => {
	vi.mocked(getBackupSchedule).mockResolvedValue(
		fromAny({
			data: {
				repository,
				volume: {
					sourceKind,
					agentId,
					config: sourceKind === "managed" ? { backend: "directory", path: "/documents" } : null,
				},
			},
		}),
	);

	const backupLoader = BackupRestoreRoute.options.loader;
	const repositoryLoader = RepositoryRestoreRoute.options.loader;
	if (typeof backupLoader !== "function" || typeof repositoryLoader !== "function") {
		throw new Error("Restore routes must define loaders");
	}

	const backup = await backupLoader(fromAny({ params: { backupId: "backup-1", snapshotId: "snapshot-1" }, context }));
	const direct = await repositoryLoader(
		fromAny({ params: { repositoryId: "repo-1", snapshotId: "snapshot-1" }, context }),
	);

	expect(backup).toMatchObject({ sourceOrigin });
	expect(direct).toMatchObject({ sourceOrigin });
});

test("a snapshot whose schedule has been removed keeps its origin unknown", async () => {
	vi.mocked(getBackupSchedule).mockResolvedValue(fromAny({ error: { message: "Not found" } }));
	const loader = RepositoryRestoreRoute.options.loader;
	if (typeof loader !== "function") throw new Error("Restore route must define a loader");

	const result = await loader(fromAny({ params: { repositoryId: "repo-1", snapshotId: "snapshot-1" }, context }));

	expect(result).toMatchObject({ sourceOrigin: "unknown" });
});
