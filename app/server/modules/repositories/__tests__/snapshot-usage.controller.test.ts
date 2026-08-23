import crypto from "node:crypto";
import { afterEach, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { createApp } from "~/server/app";
import { db } from "~/server/db/db";
import { repositoriesTable, snapshotUsageScansTable } from "~/server/db/schema";
import { generateShortId } from "~/server/utils/id";
import { createTestSession } from "~/test/helpers/auth";
import { createUsageFold } from "@zerobyte/core/usage";
import type { UsageNode } from "@zerobyte/core/usage";
import { clearSnapshotUsageCache, saveUsageTree } from "../helpers/snapshot-usage-store";

const app = createApp();

let session: Awaited<ReturnType<typeof createTestSession>>;

beforeAll(async () => {
	session = await createTestSession();
});

beforeEach(() => {
	clearSnapshotUsageCache();
});

afterEach(async () => {
	await db.delete(snapshotUsageScansTable);
	clearSnapshotUsageCache();
});

const createRepository = async (organizationId: string) => {
	const [repository] = await db
		.insert(repositoriesTable)
		.values({
			id: crypto.randomUUID(),
			shortId: generateShortId(),
			name: `Repository-${crypto.randomUUID()}`,
			type: "local",
			config: { backend: "local", path: `/tmp/${crypto.randomUUID()}` },
			organizationId,
		})
		.returning();

	if (!repository) throw new Error("Failed to create repository");
	return repository;
};

/**
 *   /data                     1300
 *     /media                  1000   (one big file)
 *     /docs                    300   (two files)
 */
const seedTree = (repositoryId: string, organizationId: string, snapshotId: string) => {
	const nodes: UsageNode[] = [
		{ path: "/data", type: "dir" },
		{ path: "/data/media", type: "dir" },
		{ path: "/data/media/movie.iso", type: "file", size: 1000, mtime: 5000 },
		{ path: "/data/docs", type: "dir" },
		{ path: "/data/docs/a.txt", type: "file", size: 200, mtime: 1000 },
		{ path: "/data/docs/b.txt", type: "file", size: 100, mtime: 2000 },
	];

	const fold = createUsageFold({ roots: ["/data"] });
	for (const node of nodes) fold.push(node);

	saveUsageTree({
		repositoryId,
		organizationId,
		snapshotId,
		source: "backup",
		durationMs: 42,
		tree: fold.finish(),
	});
};

describe("GET /repositories/:shortId/snapshots/:snapshotId/usage", () => {
	test("requires authentication", async () => {
		const repository = await createRepository(session.organizationId);
		const res = await app.request(`/api/v1/repositories/${repository.shortId}/snapshots/abc/usage`);

		expect(res.status).toBe(401);
	});

	test("reports missing rather than erroring when nothing has been captured", async () => {
		const repository = await createRepository(session.organizationId);

		const res = await app.request(`/api/v1/repositories/${repository.shortId}/snapshots/abc/usage`, {
			headers: session.headers,
		});

		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ status: "missing" });
	});

	test("lists the root's children largest first", async () => {
		const repository = await createRepository(session.organizationId);
		seedTree(repository.id, session.organizationId, "snap1");

		const res = await app.request(`/api/v1/repositories/${repository.shortId}/snapshots/snap1/usage`, {
			headers: session.headers,
		});
		const body = await res.json();

		expect(res.status).toBe(200);
		expect(body.status).toBe("ready");
		expect(body.path).toBe("/data");
		expect(body.meta.source).toBe("backup");
		expect(body.meta.totalSize).toBe(1300);
		expect(body.entries.map((entry: { name: string }) => entry.name)).toEqual(["media", "docs"]);
		expect(body.entries[0].size).toBe(1000);
		expect(body.totalEntries).toBe(2);
	});

	test("reports each child's share of its parent and of the whole tree", async () => {
		const repository = await createRepository(session.organizationId);
		seedTree(repository.id, session.organizationId, "snap1");

		const res = await app.request(`/api/v1/repositories/${repository.shortId}/snapshots/snap1/usage`, {
			headers: session.headers,
		});
		const body = await res.json();

		expect(body.entries[0].shareOfParent).toBeCloseTo(1000 / 1300);
		expect(body.entries[0].shareOfTotal).toBeCloseTo(1000 / 1300);
	});

	test("drills down into a subdirectory", async () => {
		const repository = await createRepository(session.organizationId);
		seedTree(repository.id, session.organizationId, "snap1");

		const res = await app.request(
			`/api/v1/repositories/${repository.shortId}/snapshots/snap1/usage?path=${encodeURIComponent("/data/docs")}`,
			{ headers: session.headers },
		);
		const body = await res.json();

		expect(body.path).toBe("/data/docs");
		expect(body.directory.size).toBe(300);
		expect(body.directory.ownSize).toBe(300);
		expect(body.entries.map((entry: { name: string }) => entry.name)).toEqual(["a.txt", "b.txt"]);
		expect(body.entries.every((entry: { type: string }) => entry.type === "file")).toBe(true);
	});

	test("returns an empty listing for a path that is not in the tree", async () => {
		const repository = await createRepository(session.organizationId);
		seedTree(repository.id, session.organizationId, "snap1");

		const res = await app.request(
			`/api/v1/repositories/${repository.shortId}/snapshots/snap1/usage?path=${encodeURIComponent("/data/nope")}`,
			{ headers: session.headers },
		);
		const body = await res.json();

		expect(body.status).toBe("ready");
		expect(body.directory).toBeNull();
		expect(body.entries).toEqual([]);
	});

	test("caps the listing at the requested limit but still reports the true count", async () => {
		const repository = await createRepository(session.organizationId);
		seedTree(repository.id, session.organizationId, "snap1");

		const res = await app.request(`/api/v1/repositories/${repository.shortId}/snapshots/snap1/usage?limit=1`, {
			headers: session.headers,
		});
		const body = await res.json();

		expect(body.entries).toHaveLength(1);
		expect(body.totalEntries).toBe(2);
	});

	test("does not leak another organization's tree", async () => {
		const otherSession = await createTestSession();
		const repository = await createRepository(session.organizationId);
		seedTree(repository.id, session.organizationId, "snap1");

		const res = await app.request(`/api/v1/repositories/${repository.shortId}/snapshots/snap1/usage`, {
			headers: otherSession.headers,
		});

		expect([403, 404]).toContain(res.status);
	});
});
