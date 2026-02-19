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

	test("should remove signal listener and not release unacquired lock on abort", async () => {
		const repoId = "cleanup-test";
		const controller = new AbortController();
		const signal = controller.signal;

		let removed = false;
		const originalRemove = signal.removeEventListener.bind(signal);
		signal.removeEventListener = (type: string, listener: any, options?: any) => {
			if (type === "abort") removed = true;
			return originalRemove(type, listener, options);
		};

		// Hold the lock so the next one has to wait
		const release = await repoMutex.acquireExclusive(repoId, "holder");

		const abortedAcquisition = repoMutex.acquireShared(repoId, "waiter", signal);

		// Trigger abort while it's waiting
		controller.abort();

		expect(abortedAcquisition).rejects.toThrow();
		expect(removed).toBe(true);
		expect(repoMutex.isLocked(repoId)).toBe(true);

		release();
		expect(repoMutex.isLocked(repoId)).toBe(false);
	});

	test("should allow concurrent shared locks", async () => {
		const repoId = "concurrent-shared";
		const release1 = await repoMutex.acquireShared(repoId, "op1");
		const release2 = await repoMutex.acquireShared(repoId, "op2");
		const release3 = await repoMutex.acquireShared(repoId, "op3");

		expect(repoMutex.isLocked(repoId)).toBe(true);

		release1();
		release2();
		release3();

		expect(repoMutex.isLocked(repoId)).toBe(false);
	});

	test("should block exclusive lock until all shared locks are released", async () => {
		const repoId = "shared-blocks-exclusive";
		let exclusiveAcquired = false;

		const releaseShared1 = await repoMutex.acquireShared(repoId, "s1");
		const releaseShared2 = await repoMutex.acquireShared(repoId, "s2");

		const exclusivePromise = repoMutex.acquireExclusive(repoId, "e1").then((release) => {
			exclusiveAcquired = true;
			return release;
		});

		await new Promise((resolve) => setTimeout(resolve, 10));
		expect(exclusiveAcquired).toBe(false);

		releaseShared1();
		await new Promise((resolve) => setTimeout(resolve, 10));
		expect(exclusiveAcquired).toBe(false); // still waiting for s2

		releaseShared2();
		const releaseExclusive = await exclusivePromise;
		expect(exclusiveAcquired).toBe(true);

		releaseExclusive();
	});

	test("should block all locks while exclusive lock is held", async () => {
		const repoId = "exclusive-blocks-all";
		const results: string[] = [];

		const releaseExclusive = await repoMutex.acquireExclusive(repoId, "e1");
		results.push("e1-acquired");

		const s1Promise = repoMutex.acquireShared(repoId, "s1").then((release) => {
			results.push("s1-acquired");
			return release;
		});
		const e2Promise = repoMutex.acquireExclusive(repoId, "e2").then((release) => {
			results.push("e2-acquired");
			return release;
		});

		await new Promise((resolve) => setTimeout(resolve, 10));
		expect(results).toEqual(["e1-acquired"]);

		releaseExclusive();

		const releaseS1 = await s1Promise;
		expect(results).toEqual(["e1-acquired", "s1-acquired"]);

		releaseS1();

		const releaseE2 = await e2Promise;
		expect(results).toEqual(["e1-acquired", "s1-acquired", "e2-acquired"]);

		releaseE2();
	});

	test("should grant all waiting shared locks at once when exclusive lock is released", async () => {
		const repoId = "batch-shared";
		const results: string[] = [];

		const releaseExclusive = await repoMutex.acquireExclusive(repoId, "e1");

		const s1Promise = repoMutex.acquireShared(repoId, "s1").then((release) => {
			results.push("s1");
			return release;
		});
		const s2Promise = repoMutex.acquireShared(repoId, "s2").then((release) => {
			results.push("s2");
			return release;
		});
		const s3Promise = repoMutex.acquireShared(repoId, "s3").then((release) => {
			results.push("s3");
			return release;
		});

		await new Promise((resolve) => setTimeout(resolve, 10));
		expect(results).toEqual([]);

		releaseExclusive();

		const [releaseS1, releaseS2, releaseS3] = await Promise.all([s1Promise, s2Promise, s3Promise]);

		expect(results.length).toBe(3);
		expect(results).toContain("s1");
		expect(results).toContain("s2");
		expect(results).toContain("s3");

		releaseS1();
		releaseS2();
		releaseS3();
	});

	test("should safely handle multiple calls to the release function", async () => {
		const repoId = "idempotent-release";

		const releaseShared = await repoMutex.acquireShared(repoId, "s1");
		releaseShared();
		releaseShared(); // Should not throw or cause issues
		releaseShared();

		const releaseExclusive = await repoMutex.acquireExclusive(repoId, "e1");
		releaseExclusive();
		releaseExclusive(); // Should not throw

		expect(repoMutex.isLocked(repoId)).toBe(false);
	});

	test("should immediately throw if AbortSignal is already aborted", async () => {
		const repoId = "already-aborted";
		const controller = new AbortController();
		controller.abort(new Error("pre-aborted"));

		expect(repoMutex.acquireShared(repoId, "s1", controller.signal)).rejects.toThrow("pre-aborted");
		expect(repoMutex.acquireExclusive(repoId, "e1", controller.signal)).rejects.toThrow("pre-aborted");

		expect(repoMutex.isLocked(repoId)).toBe(false);
	});

	test("should accurately report isLocked status", async () => {
		const repoId = "is-locked-status";

		expect(repoMutex.isLocked(repoId)).toBe(false);

		const releaseShared1 = await repoMutex.acquireShared(repoId, "s1");
		expect(repoMutex.isLocked(repoId)).toBe(true);

		const releaseShared2 = await repoMutex.acquireShared(repoId, "s2");
		expect(repoMutex.isLocked(repoId)).toBe(true);

		releaseShared1();
		expect(repoMutex.isLocked(repoId)).toBe(true); // still locked by s2

		releaseShared2();
		expect(repoMutex.isLocked(repoId)).toBe(false); // all shared released

		const releaseExclusive = await repoMutex.acquireExclusive(repoId, "e1");
		expect(repoMutex.isLocked(repoId)).toBe(true);

		releaseExclusive();
		expect(repoMutex.isLocked(repoId)).toBe(false);
	});
});
