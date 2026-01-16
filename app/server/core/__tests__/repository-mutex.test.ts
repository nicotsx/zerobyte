import { test, describe, expect } from "bun:test";
import { repoMutex } from "../repository-mutex";

describe("RepositoryMutex", () => {
	test("should prioritize waiting exclusive locks over new shared locks", async () => {
		const repoId = "test-repo";
		const results: string[] = [];

		const releaseShared1 = await repoMutex.acquireShared(repoId, "backup-1");
		results.push("acquired-shared-1");

		const exclusivePromise = repoMutex.acquireExclusive(repoId, "unlock").then((release) => {
			results.push("acquired-exclusive");
			return release;
		});

		const shared2Promise = repoMutex.acquireShared(repoId, "backup-2").then((release) => {
			results.push("acquired-shared-2");
			return release;
		});

		await new Promise((resolve) => setTimeout(resolve, 50));

		expect(results).toEqual(["acquired-shared-1"]);

		releaseShared1();

		const releaseExclusive = await exclusivePromise;
		expect(results).toEqual(["acquired-shared-1", "acquired-exclusive"]);

		releaseExclusive();

		const releaseShared2 = await shared2Promise;
		expect(results).toEqual(["acquired-shared-1", "acquired-exclusive", "acquired-shared-2"]);

		releaseShared2();
	});

	test("should remove aborted acquisitions from the wait queue", async () => {
		const repoId = "abort-test";
		const results: string[] = [];

		const releaseShared1 = await repoMutex.acquireShared(repoId, "backup-1");
		results.push("acquired-shared-1");

		const controller = new AbortController();
		const exclusivePromise = repoMutex.acquireExclusive(repoId, "unlock", controller.signal).catch((err) => {
			results.push("aborted-exclusive");
			throw err;
		});

		const shared2Promise = repoMutex.acquireShared(repoId, "backup-2").then((release) => {
			results.push("acquired-shared-2");
			return release;
		});

		await new Promise((resolve) => setTimeout(resolve, 50));
		expect(results).toEqual(["acquired-shared-1"]);

		controller.abort();

		expect(exclusivePromise).rejects.toThrow();
		expect(results).toEqual(["acquired-shared-1", "aborted-exclusive"]);

		releaseShared1();

		// After exclusive is aborted, shared-2 should be next
		const releaseShared2 = await shared2Promise;
		expect(results).toEqual(["acquired-shared-1", "aborted-exclusive", "acquired-shared-2"]);

		releaseShared2();
	});

	test("should handle multiple aborts correctly", async () => {
		const repoId = "multi-abort";
		const releaseShared1 = await repoMutex.acquireShared(repoId, "backup-1");

		const controller1 = new AbortController();
		const controller2 = new AbortController();

		const p1 = repoMutex.acquireExclusive(repoId, "ex-1", controller1.signal);
		const p2 = repoMutex.acquireExclusive(repoId, "ex-2", controller2.signal);
		const p3 = repoMutex.acquireExclusive(repoId, "ex-3");

		controller2.abort();
		expect(p2).rejects.toThrow();

		controller1.abort();
		expect(p1).rejects.toThrow();

		releaseShared1();

		const releaseEx3 = await p3;
		expect(releaseEx3).toBeDefined();
		releaseEx3();
	});
});
