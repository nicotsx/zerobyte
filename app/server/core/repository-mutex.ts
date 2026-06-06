import { and, eq, lte } from "drizzle-orm";
import { logger } from "@zerobyte/core/node";
import { db } from "../db/db";
import {
	repositoryLocksTable,
	repositoryLockWaitersTable,
	type RepositoryLock,
	type RepositoryLockWaiter,
} from "../db/schema";
import { Effect, Exit, Fiber, Schedule, Scope } from "effect";

type LockType = "shared" | "exclusive";

interface LockRequest {
	repositoryId: string;
	type: LockType;
	operation: string;
}

interface AcquiredLock {
	id: string;
	repositoryId: string;
	type: LockType;
	operation: string;
	acquiredAt: number;
}

type RepositoryMutexTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type HeartbeatTarget = "lock" | "waiter";
type QueueAttempt = { status: "acquired"; lock: AcquiredLock } | { status: "waiting" } | { status: "missing" };

const LOCK_LEASE_MS = 30_000;
const LOCK_HEARTBEAT_MS = 5_000;
const LOCK_POLL_MS = 250;
const LOCK_POLL_CLEANUP_MS = 5_000;

const REPOSITORY_MUTEX_INSTANCE = Symbol.for("zerobyte.repositoryMutex.instance");
function getRepositoryMutex() {
	const globalObject = globalThis as typeof globalThis & Record<symbol, RepositoryMutex | undefined>;
	const mutex = globalObject[REPOSITORY_MUTEX_INSTANCE];

	if (mutex) return mutex;

	const newMutex = new RepositoryMutex();
	globalObject[REPOSITORY_MUTEX_INSTANCE] = newMutex;
	return newMutex;
}

class RepositoryMutex {
	private ownerId = `owner_${Bun.randomUUIDv7()}`;
	private nextPollCleanupAt = 0;

	private generateLockId(): string {
		return `lock_${Bun.randomUUIDv7()}`;
	}

	private abortReason(signal: AbortSignal): Error {
		return signal.reason || new Error("Operation aborted");
	}

	private cleanupExpired(tx: RepositoryMutexTransaction, now: number) {
		tx.delete(repositoryLocksTable).where(lte(repositoryLocksTable.expiresAt, now)).run();
		tx.delete(repositoryLockWaitersTable).where(lte(repositoryLockWaitersTable.expiresAt, now)).run();
	}

	private cleanupExpiredDuringPolling(tx: RepositoryMutexTransaction, now: number) {
		if (now < this.nextPollCleanupAt) return;

		this.cleanupExpired(tx, now);
		this.nextPollCleanupAt = now + LOCK_POLL_CLEANUP_MS;
	}

	private getActiveLocks(tx: RepositoryMutexTransaction, repositoryId: string, now: number) {
		return tx.query.repositoryLocksTable
			.findMany({
				where: { AND: [{ repositoryId: { eq: repositoryId } }, { expiresAt: { gt: now } }] },
				orderBy: { acquiredAt: "asc", id: "asc" },
			})
			.sync();
	}

	private getWaiters(tx: RepositoryMutexTransaction, repositoryId: string, now: number) {
		return tx.query.repositoryLockWaitersTable
			.findMany({
				where: { AND: [{ repositoryId: { eq: repositoryId } }, { expiresAt: { gt: now } }] },
				orderBy: { requestedAt: "asc", id: "asc" },
			})
			.sync();
	}

	private getActiveLockById(tx: RepositoryMutexTransaction, lockId: string, now: number) {
		return tx.query.repositoryLocksTable
			.findFirst({ where: { AND: [{ id: { eq: lockId } }, { expiresAt: { gt: now } }] } })
			.sync();
	}

	private getWaiterById(tx: RepositoryMutexTransaction, waiterId: string, now: number) {
		return tx.query.repositoryLockWaitersTable
			.findFirst({ where: { AND: [{ id: { eq: waiterId } }, { expiresAt: { gt: now } }] } })
			.sync();
	}

	private canAcquireImmediately(type: LockType, activeLocks: RepositoryLock[], waiters: RepositoryLockWaiter[]) {
		if (type === "shared") {
			return (
				!activeLocks.some((lock) => lock.type === "exclusive") &&
				!waiters.some((waiter) => waiter.type === "exclusive")
			);
		}

		return activeLocks.length === 0 && waiters.length === 0;
	}

	private insertLock(
		tx: RepositoryMutexTransaction,
		request: LockRequest & { id: string; ownerId: string },
		now: number,
	) {
		const lock = {
			id: request.id,
			repositoryId: request.repositoryId,
			type: request.type,
			operation: request.operation,
			ownerId: request.ownerId,
			acquiredAt: now,
			expiresAt: now + LOCK_LEASE_MS,
			heartbeatAt: now,
		};

		tx.insert(repositoryLocksTable).values(lock).run();

		return lock;
	}

	private tryAcquireManyRows(requests: LockRequest[]) {
		const now = Date.now();

		return db.transaction((tx) => {
			this.cleanupExpired(tx, now);

			for (const request of requests) {
				const activeLocks = this.getActiveLocks(tx, request.repositoryId, now);
				const waiters = this.getWaiters(tx, request.repositoryId, now);

				if (!this.canAcquireImmediately(request.type, activeLocks, waiters)) {
					return null;
				}
			}

			return requests.map((request) =>
				this.insertLock(tx, { ...request, id: this.generateLockId(), ownerId: this.ownerId }, now),
			);
		});
	}

	private tryAcquireImmediately(request: LockRequest) {
		return Effect.gen(this, function* () {
			const locks = this.tryAcquireManyRows([request]);
			if (!locks || locks.length === 0) return null;

			const [lock] = locks;
			return yield* this.createRelease(lock);
		});
	}

	private createWaiter(request: LockRequest, waiterId: string) {
		return Effect.sync(() => {
			const now = Date.now();
			db.transaction((tx) => {
				this.cleanupExpired(tx, now);
				tx.insert(repositoryLockWaitersTable)
					.values({
						id: waiterId,
						repositoryId: request.repositoryId,
						type: request.type,
						operation: request.operation,
						ownerId: this.ownerId,
						requestedAt: now,
						expiresAt: now + LOCK_LEASE_MS,
						heartbeatAt: now,
					})
					.run();
			});
		});
	}

	private deleteWaiter(waiterId: string) {
		return Effect.sync(() =>
			db
				.delete(repositoryLockWaitersTable)
				.where(
					and(
						eq(repositoryLockWaitersTable.id, waiterId),
						eq(repositoryLockWaitersTable.ownerId, this.ownerId),
					),
				)
				.run(),
		);
	}

	private deleteWaiterRow(tx: RepositoryMutexTransaction, waiterId: string): void {
		tx.delete(repositoryLockWaitersTable).where(eq(repositoryLockWaitersTable.id, waiterId)).run();
	}

	private promoteWaiter(tx: RepositoryMutexTransaction, waiter: RepositoryLockWaiter, now: number) {
		this.deleteWaiterRow(tx, waiter.id);
		return this.insertLock(tx, { ...waiter, id: waiter.id }, now);
	}

	private getLeadingSharedWaiters(waiters: RepositoryLockWaiter[]) {
		const leadingSharedWaiters: RepositoryLockWaiter[] = [];
		for (const waiter of waiters) {
			if (waiter.type === "exclusive") break;

			leadingSharedWaiters.push(waiter);
		}

		return leadingSharedWaiters;
	}

	private tryPromoteWaiter(waiterId: string): QueueAttempt {
		const now = Date.now();

		return db.transaction((tx) => {
			this.cleanupExpiredDuringPolling(tx, now);

			const activeLock = this.getActiveLockById(tx, waiterId, now);
			if (activeLock) {
				return { status: "acquired", lock: activeLock };
			}

			const waiter = this.getWaiterById(tx, waiterId, now);
			if (!waiter) {
				return { status: "missing" };
			}

			const activeLocks = this.getActiveLocks(tx, waiter.repositoryId, now);
			const waiters = this.getWaiters(tx, waiter.repositoryId, now);

			if (waiter.type === "exclusive") {
				if (activeLocks.length > 0 || waiters[0]?.id !== waiter.id) {
					return { status: "waiting" };
				}

				return { status: "acquired", lock: this.promoteWaiter(tx, waiter, now) };
			}

			if (activeLocks.some((lock) => lock.type === "exclusive")) {
				return { status: "waiting" };
			}

			const leadingSharedWaiters = this.getLeadingSharedWaiters(waiters);
			if (!leadingSharedWaiters.some((queuedWaiter) => queuedWaiter.id === waiter.id)) {
				return { status: "waiting" };
			}

			let acquiredLock: AcquiredLock | null = null;
			for (const sharedWaiter of leadingSharedWaiters) {
				const lock = this.promoteWaiter(tx, sharedWaiter, now);

				if (sharedWaiter.id === waiter.id) {
					acquiredLock = lock;
				}
			}

			if (!acquiredLock) {
				return { status: "waiting" };
			}

			return { status: "acquired", lock: acquiredLock };
		});
	}

	private waitForQueuedLock(request: LockRequest) {
		const waiterId = this.generateLockId();

		const attempt = Effect.sync(() => this.tryPromoteWaiter(waiterId)).pipe(
			Effect.flatMap((attempt) => {
				if (attempt.status === "acquired") {
					return Effect.succeed(attempt.lock);
				}

				if (attempt.status === "missing") {
					return Effect.gen(this, function* () {
						yield* this.createWaiter(request, waiterId);
						yield* this.startHeartbeat("waiter", waiterId);

						return yield* Effect.fail("retry");
					});
				}

				return Effect.fail("retry");
			}),
		);

		const cleanupAbandonedWaiter = Effect.gen(this, function* () {
			yield* this.deleteWaiter(waiterId);
			yield* this.release({ id: waiterId });
		});

		return Effect.scoped(
			Effect.gen(this, function* () {
				const lock = yield* attempt.pipe(
					Effect.retry(Schedule.spaced(LOCK_POLL_MS)),
					Effect.onExit((exit) => {
						if (Exit.isSuccess(exit)) {
							return Effect.void;
						}

						return cleanupAbandonedWaiter;
					}),
				);

				return yield* this.createRelease(lock);
			}),
		);
	}

	isLocked(repositoryId: string) {
		const now = Date.now();

		return db.transaction((tx) => {
			this.cleanupExpired(tx, now);
			return this.getActiveLocks(tx, repositoryId, now).length > 0;
		});
	}

	private createReleaseMany(locks: AcquiredLock[]) {
		return Effect.gen(this, function* () {
			const releases = yield* Effect.all(locks.map((lock) => this.createRelease(lock)));
			let released = false;

			return () => {
				if (released) return;

				released = true;
				for (const release of releases.toReversed()) {
					release();
				}
			};
		});
	}

	private createRelease(lock: AcquiredLock) {
		return Effect.gen(this, function* () {
			const heartbeatFiber = yield* this.startHeartbeat("lock", lock.id);
			let released = false;

			return () => {
				if (released) return;

				released = true;
				Effect.runFork(Fiber.interrupt(heartbeatFiber));
				Effect.runSync(this.release(lock));
			};
		});
	}

	private release(lock: Pick<AcquiredLock, "id">) {
		return Effect.gen(this, function* () {
			const releasedLock = yield* Effect.sync(() =>
				db.transaction((tx) => {
					const row = tx.query.repositoryLocksTable
						.findFirst({ where: { AND: [{ id: { eq: lock.id } }, { ownerId: { eq: this.ownerId } }] } })
						.sync();

					if (!row) return null;

					tx.delete(repositoryLocksTable)
						.where(
							and(eq(repositoryLocksTable.id, lock.id), eq(repositoryLocksTable.ownerId, this.ownerId)),
						)
						.run();

					return row;
				}),
			);

			if (!releasedLock) return;

			const duration = Date.now() - releasedLock.acquiredAt;

			yield* logger.effect.debug(
				`[Mutex] Released ${releasedLock.type} lock for repo ${releasedLock.repositoryId}: ${releasedLock.operation} (held for ${duration}ms)`,
			);
		});
	}

	private startHeartbeat(
		target: "waiter",
		lockId: string,
	): Effect.Effect<Fiber.RuntimeFiber<void, never>, never, Scope.Scope>;
	private startHeartbeat(
		target: "lock",
		lockId: string,
	): Effect.Effect<Fiber.RuntimeFiber<void, never>, never, never>;
	private startHeartbeat(
		target: HeartbeatTarget,
		lockId: string,
	): Effect.Effect<Fiber.RuntimeFiber<unknown, never>, never, Scope.Scope> {
		const heartbeat = Effect.gen(this, function* () {
			const now = Date.now();
			const values = { heartbeatAt: now, expiresAt: now + LOCK_LEASE_MS };

			if (target === "lock") {
				yield* Effect.try(() => {
					db.update(repositoryLocksTable)
						.set(values)
						.where(and(eq(repositoryLocksTable.id, lockId), eq(repositoryLocksTable.ownerId, this.ownerId)))
						.run();
				});
			} else {
				yield* Effect.try(() => {
					db.update(repositoryLockWaitersTable)
						.set(values)
						.where(
							and(
								eq(repositoryLockWaitersTable.id, lockId),
								eq(repositoryLockWaitersTable.ownerId, this.ownerId),
							),
						)
						.run();
				});
			}
		}).pipe(
			Effect.catchAll((error) =>
				logger.effect.warn(`[Mutex] Failed to heartbeat ${target} ${lockId}: ${String(error)}`),
			),
		);

		const repeat = heartbeat.pipe(Effect.repeat(Schedule.spaced(LOCK_HEARTBEAT_MS)));

		if (target === "waiter") {
			// For waiters, we can stop heartbeating when the releaser is dropped, so we use a scoped fiber
			return repeat.pipe(Effect.forkScoped);
		}

		// For locks, the heartbeat must outlive the acquire scope.
		// It is interrupted manually by the returned release function.
		// TODO: max lifetime for lock heartbeats to prevent leaks if the releaser is never called?
		return repeat.pipe(Effect.forkDaemon);
	}

	private acquireSharedEffect(repositoryId: string, operation: string) {
		return Effect.gen(this, function* () {
			const request: LockRequest = { repositoryId, type: "shared", operation };
			const releaseLock = yield* this.tryAcquireImmediately(request);
			if (releaseLock) return releaseLock;

			yield* logger.effect.debug(`[Mutex] Waiting for shared lock on repo ${repositoryId}: ${operation}`);
			return yield* this.waitForQueuedLock(request);
		});
	}

	private acquireExclusiveEffect(repositoryId: string, operation: string) {
		return Effect.gen(this, function* () {
			const request: LockRequest = { repositoryId, type: "exclusive", operation };
			const releaseLock = yield* this.tryAcquireImmediately(request);
			if (releaseLock) {
				yield* logger.effect.debug(`[Mutex] Acquired exclusive lock for repo ${repositoryId}: ${operation}`);
				return releaseLock;
			}

			yield* logger.effect.debug(`[Mutex] Waiting for exclusive lock on repo ${repositoryId}: ${operation}`);
			const queuedReleaseLock = yield* this.waitForQueuedLock(request);
			yield* logger.effect.debug(`[Mutex] Acquired exclusive lock for repo ${repositoryId}: ${operation}`);
			return queuedReleaseLock;
		});
	}

	private acquireManyEffect(requests: LockRequest[]) {
		return Effect.gen(this, function* () {
			if (requests.length === 0) {
				return () => {};
			}

			const seenRepositoryIds = new Set<string>();
			for (const request of requests) {
				if (seenRepositoryIds.has(request.repositoryId)) {
					throw new Error(`Duplicate repository lock request: ${request.repositoryId}`);
				}
				seenRepositoryIds.add(request.repositoryId);
			}

			const sortedRequests = [...requests].sort((a, b) => a.repositoryId.localeCompare(b.repositoryId));

			const locks = yield* Effect.sync(() => this.tryAcquireManyRows(sortedRequests)).pipe(
				Effect.flatMap((locks) => {
					if (locks) return Effect.succeed(locks);
					return Effect.fail("retry");
				}),
				Effect.retry(Schedule.spaced(LOCK_POLL_MS)),
			);

			return yield* this.createReleaseMany(locks);
		});
	}

	private runWithSignal<A, E>(effect: Effect.Effect<A, E>, signal?: AbortSignal) {
		if (!signal) return Effect.runPromise(effect);

		if (signal.aborted) {
			return Promise.reject(this.abortReason(signal));
		}

		return new Promise<A>((resolve, reject) => {
			const fiber = Effect.runFork(effect);
			let settled = false;
			let aborting = false;

			const complete = (callback: () => void) => {
				if (settled) return;

				settled = true;
				signal.removeEventListener("abort", onAbort);
				callback();
			};

			const onAbort = () => {
				aborting = true;
				Effect.runPromise(Fiber.interrupt(fiber)).then(
					(exit) =>
						complete(() => {
							if (Exit.isSuccess(exit)) {
								resolve(exit.value);
								return;
							}

							reject(this.abortReason(signal));
						}),
					(error) => complete(() => reject(error)),
				);
			};

			signal.addEventListener("abort", onAbort, { once: true });

			Effect.runPromise(Fiber.join(fiber)).then(
				(value) => complete(() => resolve(value)),
				(error) => {
					if (!aborting) {
						complete(() => reject(error));
					}
				},
			);
		});
	}

	async acquireShared(repositoryId: string, operation: string, signal?: AbortSignal) {
		return await this.runWithSignal(this.acquireSharedEffect(repositoryId, operation), signal);
	}

	async acquireExclusive(repositoryId: string, operation: string, signal?: AbortSignal) {
		return await this.runWithSignal(this.acquireExclusiveEffect(repositoryId, operation), signal);
	}

	async acquireMany(requests: LockRequest[], signal?: AbortSignal) {
		return await this.runWithSignal(this.acquireManyEffect(requests), signal);
	}
}

export const repoMutex = getRepositoryMutex();
