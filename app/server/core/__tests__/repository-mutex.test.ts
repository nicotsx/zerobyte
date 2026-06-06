import { describe, expect, test, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "~/server/db/db";
import { repositoryLocksTable, repositoryLockWaitersTable } from "~/server/db/schema";
import { repoMutex } from "../repository-mutex";

const acquireWithin = <T>(promise: Promise<T>, ms = 500) =>
	Promise.race([
		promise,
		new Promise<never>((_, reject) => {
			setTimeout(() => reject(new Error(`Timed out after ${ms}ms`)), ms);
		}),
	]);

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

		await expect(exclusivePromise).rejects.toThrow();
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
		await expect(p2).rejects.toThrow();

		controller1.abort();
		await expect(p1).rejects.toThrow();

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

		await expect(abortedAcquisition).rejects.toThrow();
		expect(removed).toBe(true);
		expect(repoMutex.isLocked(repoId)).toBe(true);

		release();
		expect(repoMutex.isLocked(repoId)).toBe(false);
	});

	test("should reject aborted queued acquisitions only after waiter cleanup finishes", async () => {
		const repoId = "abort-waits-for-cleanup";
		const releaseHolder = await repoMutex.acquireExclusive(repoId, "holder");
		const controller = new AbortController();
		const waitingAcquisition = repoMutex.acquireShared(repoId, "waiter", controller.signal);

		try {
			await new Promise((resolve) => setTimeout(resolve, 50));

			const waitersBeforeAbort = await db.query.repositoryLockWaitersTable.findMany({
				where: { repositoryId: { eq: repoId } },
			});

			expect(waitersBeforeAbort.map((waiter) => waiter.operation)).toEqual(["waiter"]);

			controller.abort(new Error("stop"));
			await expect(waitingAcquisition).rejects.toThrow("stop");

			const waitersAfterAbort = await db.query.repositoryLockWaitersTable.findMany({
				where: { repositoryId: { eq: repoId } },
			});

			expect(waitersAfterAbort).toEqual([]);
			expect(repoMutex.isLocked(repoId)).toBe(true);
		} finally {
			releaseHolder();
			await db.delete(repositoryLockWaitersTable).where(eq(repositoryLockWaitersTable.repositoryId, repoId));
			await db.delete(repositoryLocksTable).where(eq(repositoryLocksTable.repositoryId, repoId));
		}
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

	test("should wait to acquire all many-lock requests before locking any repository", async () => {
		const releaseSharedB = await repoMutex.acquireShared("repo-b", "holder-b");
		let manyAcquired = false;
		let exclusiveAAcquired = false;

		const manyPromise = repoMutex
			.acquireMany([
				{ repositoryId: "repo-b", type: "exclusive", operation: "many-b" },
				{ repositoryId: "repo-a", type: "shared", operation: "many-a" },
			])
			.then((release) => {
				manyAcquired = true;
				return release;
			});

		await new Promise((resolve) => setTimeout(resolve, 10));

		const exclusiveAPromise = repoMutex.acquireExclusive("repo-a", "exclusive-a").then((release) => {
			exclusiveAAcquired = true;
			return release;
		});

		await new Promise((resolve) => setTimeout(resolve, 10));
		expect(exclusiveAAcquired).toBe(true);
		expect(manyAcquired).toBe(false);

		releaseSharedB();
		await new Promise((resolve) => setTimeout(resolve, 10));
		expect(manyAcquired).toBe(false);

		const releaseExclusiveA = await exclusiveAPromise;
		releaseExclusiveA();

		const releaseMany = await manyPromise;
		expect(manyAcquired).toBe(true);
		releaseMany();
	});

	test("should abort acquireMany without leaving partial locks behind", async () => {
		const releaseExclusiveB = await repoMutex.acquireExclusive("repo-b", "holder-b");
		const controller = new AbortController();

		const manyPromise = repoMutex.acquireMany(
			[
				{ repositoryId: "repo-b", type: "exclusive", operation: "many-b" },
				{ repositoryId: "repo-a", type: "shared", operation: "many-a" },
			],
			controller.signal,
		);

		await new Promise((resolve) => setTimeout(resolve, 10));

		let exclusiveAAcquired = false;
		const exclusiveAPromise = repoMutex.acquireExclusive("repo-a", "exclusive-a").then((release) => {
			exclusiveAAcquired = true;
			return release;
		});

		await new Promise((resolve) => setTimeout(resolve, 10));
		expect(exclusiveAAcquired).toBe(true);

		controller.abort(new Error("stop"));
		await expect(manyPromise).rejects.toThrow("stop");

		const releaseExclusiveA = await exclusiveAPromise;
		expect(exclusiveAAcquired).toBe(true);

		releaseExclusiveA();
		releaseExclusiveB();
	});

	test("should abort acquireMany if the signal aborts after waiting resolves", async () => {
		const repoA = "many-abort-after-wake-a";
		const repoB = "many-abort-after-wake-b";
		const releaseExclusiveB = await repoMutex.acquireExclusive(repoB, "holder-b");
		const controller = new AbortController();

		const manyPromise = repoMutex.acquireMany(
			[
				{ repositoryId: repoB, type: "exclusive", operation: "many-b" },
				{ repositoryId: repoA, type: "shared", operation: "many-a" },
			],
			controller.signal,
		);

		await new Promise((resolve) => setTimeout(resolve, 10));

		releaseExclusiveB();
		controller.abort(new Error("stop after wake"));

		await expect(manyPromise).rejects.toThrow("stop after wake");
		expect(repoMutex.isLocked(repoA)).toBe(false);
		expect(repoMutex.isLocked(repoB)).toBe(false);
	});

	test("should not leave a promoted shared lock behind if that waiter aborts before observing acquisition", async () => {
		vi.useFakeTimers();
		const repoId = "shared-abort-after-promotion";
		const releaseExclusive = await repoMutex.acquireExclusive(repoId, "holder");
		const firstSharedPromise = repoMutex.acquireShared(repoId, "shared-1");

		try {
			await vi.advanceTimersByTimeAsync(100);

			const controller = new AbortController();
			const secondSharedPromise = repoMutex.acquireShared(repoId, "shared-2", controller.signal);

			await vi.advanceTimersByTimeAsync(140);
			releaseExclusive();

			// The first shared waiter wakes first and promotes both shared waiters.
			await vi.advanceTimersByTimeAsync(10);
			const releaseShared1 = await firstSharedPromise;

			controller.abort(new Error("abort after promotion"));
			await expect(secondSharedPromise).rejects.toThrow("abort after promotion");

			releaseShared1();

			const remainingLocks = await db.query.repositoryLocksTable.findMany({
				where: { repositoryId: { eq: repoId } },
				orderBy: { operation: "asc" },
			});

			expect(remainingLocks).toEqual([]);
		} finally {
			await db.delete(repositoryLockWaitersTable).where(eq(repositoryLockWaitersTable.repositoryId, repoId));
			await db.delete(repositoryLocksTable).where(eq(repositoryLocksTable.repositoryId, repoId));
			vi.useRealTimers();
		}
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

		await expect(repoMutex.acquireShared(repoId, "s1", controller.signal)).rejects.toThrow("pre-aborted");
		await expect(repoMutex.acquireExclusive(repoId, "e1", controller.signal)).rejects.toThrow("pre-aborted");

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

	test("should ignore and clean expired active lock rows during acquisition", async () => {
		const repoId = "expired-active-lock";
		const expiredLockId = "expired-active-lock-row";
		const now = Date.now();

		await db.insert(repositoryLocksTable).values({
			id: expiredLockId,
			repositoryId: repoId,
			type: "exclusive",
			operation: "stale-check",
			ownerId: "stale-owner",
			acquiredAt: now - 10_000,
			expiresAt: now - 1,
			heartbeatAt: now - 10_000,
		});

		const releaseShared = await acquireWithin(repoMutex.acquireShared(repoId, "backup"));

		try {
			const expiredLock = await db.query.repositoryLocksTable.findFirst({
				where: { id: { eq: expiredLockId } },
			});

			expect(expiredLock).toBeUndefined();
			expect(repoMutex.isLocked(repoId)).toBe(true);
		} finally {
			releaseShared();
			await db.delete(repositoryLocksTable).where(eq(repositoryLocksTable.repositoryId, repoId));
		}
	});

	test("should ignore and clean expired waiters during acquisition", async () => {
		const repoId = "expired-waiter";
		const expiredWaiterId = "expired-waiter-row";
		const now = Date.now();

		await db.insert(repositoryLockWaitersTable).values({
			id: expiredWaiterId,
			repositoryId: repoId,
			type: "exclusive",
			operation: "stale-exclusive",
			ownerId: "stale-owner",
			requestedAt: now - 10_000,
			expiresAt: now - 1,
			heartbeatAt: now - 10_000,
		});

		const releaseShared = await acquireWithin(repoMutex.acquireShared(repoId, "backup"));

		try {
			const expiredWaiter = await db.query.repositoryLockWaitersTable.findFirst({
				where: { id: { eq: expiredWaiterId } },
			});

			expect(expiredWaiter).toBeUndefined();
			expect(repoMutex.isLocked(repoId)).toBe(true);
		} finally {
			releaseShared();
			await db.delete(repositoryLockWaitersTable).where(eq(repositoryLockWaitersTable.repositoryId, repoId));
			await db.delete(repositoryLocksTable).where(eq(repositoryLocksTable.repositoryId, repoId));
		}
	});

	test("should release only the caller lock row", async () => {
		const repoId = "release-own-row";
		const foreignLockId = "foreign-release-own-row";
		const releaseShared = await repoMutex.acquireShared(repoId, "owned-shared");
		const now = Date.now();

		try {
			await db.insert(repositoryLocksTable).values({
				id: foreignLockId,
				repositoryId: repoId,
				type: "shared",
				operation: "foreign-shared",
				ownerId: "foreign-owner",
				acquiredAt: now,
				expiresAt: now + 60_000,
				heartbeatAt: now,
			});

			releaseShared();

			const remainingLocks = await db.query.repositoryLocksTable.findMany({
				where: { repositoryId: { eq: repoId } },
				orderBy: { operation: "asc" },
			});

			expect(remainingLocks.map((lock) => lock.operation)).toEqual(["foreign-shared"]);
			expect(repoMutex.isLocked(repoId)).toBe(true);
		} finally {
			releaseShared();
			await db.delete(repositoryLocksTable).where(eq(repositoryLocksTable.repositoryId, repoId));
		}
	});
});
