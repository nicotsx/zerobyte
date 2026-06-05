import { and, eq, lte } from "drizzle-orm";
import { logger } from "@zerobyte/core/node";
import { db } from "../db/db";
import {
	repositoryLocksTable,
	repositoryLockWaitersTable,
	type RepositoryLock,
	type RepositoryLockWaiter,
} from "../db/schema";

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

interface RepositoryLease {
	signal: AbortSignal;
	release: () => void;
}

interface ActiveRepositoryOperation {
	abortController: AbortController;
	cleanup: () => void;
	completion: Promise<unknown>;
	release: (() => void) | null;
}

type RepositoryOperationContext = {
	signal: AbortSignal;
};

type RepositoryOperation<T> = (context: RepositoryOperationContext) => T | Promise<T>;

type RepositoryMutexTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type HeartbeatTarget = "lock" | "waiter";
type QueueAttempt = { status: "acquired"; lock: AcquiredLock } | { status: "waiting" } | { status: "missing" };

const LOCK_LEASE_MS = 30_000;
const LOCK_HEARTBEAT_MS = 5_000;
const LOCK_POLL_MS = 250;
const LOCK_POLL_CLEANUP_MS = 5_000;
const SHUTDOWN_WAIT_MS = 5_000;
const REPOSITORY_MUTEX_INSTANCE = Symbol.for("zerobyte.repositoryMutex.instance");

function getRepositoryMutex() {
	const globalObject = globalThis as typeof globalThis & Record<symbol, RepositoryMutex | undefined>;
	const mutex = globalObject[REPOSITORY_MUTEX_INSTANCE];

	if (mutex) return mutex;

	const newMutex = new RepositoryMutex();
	globalObject[REPOSITORY_MUTEX_INSTANCE] = newMutex;
	return newMutex;
}

export class RepositoryMutex {
	private ownerId = `owner_${Bun.randomUUIDv7()}`;
	private heartbeatTimers = new Map<string, ReturnType<typeof setInterval>>();
	private activeOperations = new Map<string, ActiveRepositoryOperation>();
	private nextPollCleanupAt = 0;
	private shuttingDown = false;
	private shutdownPromise: Promise<void> | null = null;

	private generateLockId(): string {
		return `lock_${Bun.randomUUIDv7()}`;
	}

	private abortReason(signal: AbortSignal) {
		return signal.reason || new Error("Operation aborted");
	}

	private throwIfAborted(signal?: AbortSignal) {
		if (signal?.aborted) {
			throw this.abortReason(signal);
		}
	}

	private releaseIfAborted(releaseLock: () => void, signal?: AbortSignal) {
		if (!signal?.aborted) return;
		releaseLock();
		throw this.abortReason(signal);
	}

	private throwIfShuttingDown() {
		if (this.shuttingDown) {
			throw new Error("Repository mutex is shutting down");
		}
	}

	private createOperationController(signal?: AbortSignal) {
		const abortController = new AbortController();
		const abortOperation = () => {
			if (!abortController.signal.aborted) {
				abortController.abort(signal ? this.abortReason(signal) : new Error("Operation aborted"));
			}
		};

		if (signal?.aborted) {
			abortOperation();
		} else {
			signal?.addEventListener("abort", abortOperation, { once: true });
		}

		return {
			abortController,
			cleanup: () => signal?.removeEventListener("abort", abortOperation),
		};
	}

	private createLease(releaseLock: () => void, signal?: AbortSignal): RepositoryLease {
		const abortController = new AbortController();
		let released = false;
		const abortLease = () => {
			if (!abortController.signal.aborted) {
				abortController.abort(signal ? this.abortReason(signal) : new Error("Operation aborted"));
			}
		};

		if (signal?.aborted) {
			abortLease();
		} else {
			signal?.addEventListener("abort", abortLease, { once: true });
		}

		return {
			signal: abortController.signal,
			release: () => {
				if (released) return;

				released = true;
				signal?.removeEventListener("abort", abortLease);
				releaseLock();
			},
		};
	}

	private async runWithLease<T>(lease: RepositoryLease, operation: RepositoryOperation<T>) {
		try {
			this.throwIfAborted(lease.signal);
			return await operation({ signal: lease.signal });
		} finally {
			lease.release();
		}
	}

	private runManagedOperation<T>(
		openLease: (signal: AbortSignal) => Promise<RepositoryLease>,
		operation: RepositoryOperation<T>,
		signal?: AbortSignal,
	) {
		this.throwIfShuttingDown();

		const operationId = `operation_${Bun.randomUUIDv7()}`;
		const { abortController, cleanup } = this.createOperationController(signal);
		const activeOperation: ActiveRepositoryOperation = {
			abortController,
			cleanup,
			completion: Promise.resolve(),
			release: null,
		};

		const completion = (async () => {
			const lease = await openLease(abortController.signal);
			activeOperation.release = lease.release;
			return await this.runWithLease(lease, operation);
		})();

		activeOperation.completion = completion.finally(() => {
			cleanup();
			this.activeOperations.delete(operationId);
		});
		this.activeOperations.set(operationId, activeOperation);

		return activeOperation.completion as Promise<T>;
	}

	private waitForShutdownSettled(operations: ActiveRepositoryOperation[], timeoutMs: number) {
		if (operations.length === 0) {
			return Promise.resolve();
		}

		return new Promise<void>((resolve) => {
			const timeout = setTimeout(resolve, timeoutMs);
			void Promise.allSettled(operations.map((operation) => operation.completion)).then(() => {
				clearTimeout(timeout);
				resolve();
			});
		});
	}

	private releaseOwnedRows() {
		db.transaction((tx) => {
			tx.delete(repositoryLockWaitersTable).where(eq(repositoryLockWaitersTable.ownerId, this.ownerId)).run();
			tx.delete(repositoryLocksTable).where(eq(repositoryLocksTable.ownerId, this.ownerId)).run();
		});
	}

	private stopAllHeartbeats() {
		for (const timer of this.heartbeatTimers.values()) {
			clearInterval(timer);
		}
		this.heartbeatTimers.clear();
	}

	private waitForPoll(signal?: AbortSignal) {
		this.throwIfAborted(signal);

		return new Promise<void>((resolve, reject) => {
			let settled = false;
			const timeout = setTimeout(() => settle(resolve), LOCK_POLL_MS);

			const onAbort = () => {
				settle(() => reject(this.abortReason(signal!)));
			};

			const cleanup = () => {
				clearTimeout(timeout);
				signal?.removeEventListener("abort", onAbort);
			};

			const settle = (callback: () => void) => {
				if (settled) return;

				settled = true;
				cleanup();
				callback();
			};

			signal?.addEventListener("abort", onAbort, { once: true });
		});
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

	private tryAcquireImmediately(request: LockRequest, signal?: AbortSignal) {
		const locks = this.tryAcquireManyRows([request]);
		if (!locks || locks.length === 0) return null;

		const [lock] = locks;
		const releaseLock = this.createRelease(lock);
		this.releaseIfAborted(releaseLock, signal);

		return releaseLock;
	}

	private createWaiter(request: LockRequest, waiterId: string) {
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
	}

	private deleteWaiter(waiterId: string) {
		db.delete(repositoryLockWaitersTable)
			.where(
				and(eq(repositoryLockWaitersTable.id, waiterId), eq(repositoryLockWaitersTable.ownerId, this.ownerId)),
			)
			.run();
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

	private async waitForQueuedLock(request: LockRequest, signal?: AbortSignal) {
		this.throwIfAborted(signal);

		const waiterId = this.generateLockId();
		this.createWaiter(request, waiterId);
		this.startHeartbeat("waiter", waiterId);

		try {
			while (true) {
				this.throwIfAborted(signal);

				const attempt = this.tryPromoteWaiter(waiterId);
				if (attempt.status === "acquired") {
					this.stopHeartbeat(waiterId);
					const releaseLock = this.createRelease(attempt.lock);
					this.releaseIfAborted(releaseLock, signal);

					return releaseLock;
				}

				if (attempt.status === "missing") {
					this.createWaiter(request, waiterId);
					this.startHeartbeat("waiter", waiterId);
				}

				await this.waitForPoll(signal);
			}
		} catch (error) {
			this.stopHeartbeat(waiterId);
			this.deleteWaiter(waiterId);
			this.release({ id: waiterId });
			throw error;
		}
	}

	private async openSingleLease(request: LockRequest, signal?: AbortSignal) {
		this.throwIfAborted(signal);

		const releaseLock = this.tryAcquireImmediately(request, signal);
		if (releaseLock) {
			return this.createLease(releaseLock, signal);
		}

		logger.debug(`[Mutex] Waiting for ${request.type} lock on repo ${request.repositoryId}: ${request.operation}`);
		return this.createLease(await this.waitForQueuedLock(request, signal), signal);
	}

	private async openManyLease(requests: LockRequest[], signal?: AbortSignal) {
		this.throwIfAborted(signal);

		if (requests.length === 0) {
			return this.createLease(() => {}, signal);
		}

		const seenRepositoryIds = new Set<string>();
		for (const request of requests) {
			if (seenRepositoryIds.has(request.repositoryId)) {
				throw new Error(`Duplicate repository lock request: ${request.repositoryId}`);
			}
			seenRepositoryIds.add(request.repositoryId);
		}

		const sortedRequests = [...requests].sort((a, b) => a.repositoryId.localeCompare(b.repositoryId));
		while (true) {
			const locks = this.tryAcquireManyRows(sortedRequests);
			if (locks) {
				const releaseLocks = this.createReleaseMany(locks);
				this.releaseIfAborted(releaseLocks, signal);

				return this.createLease(releaseLocks, signal);
			}

			await this.waitForPoll(signal);
		}
	}

	async runShared<T>(
		repositoryId: string,
		operation: string,
		callback: RepositoryOperation<T>,
		signal?: AbortSignal,
	) {
		return this.runManagedOperation(
			(operationSignal) => this.openSingleLease({ repositoryId, type: "shared", operation }, operationSignal),
			callback,
			signal,
		);
	}

	async runExclusive<T>(
		repositoryId: string,
		operation: string,
		callback: RepositoryOperation<T>,
		signal?: AbortSignal,
	) {
		return this.runManagedOperation(
			async (operationSignal) => {
				const lease = await this.openSingleLease(
					{ repositoryId, type: "exclusive", operation },
					operationSignal,
				);
				logger.debug(`[Mutex] Acquired exclusive lock for repo ${repositoryId}: ${operation}`);
				return lease;
			},
			callback,
			signal,
		);
	}

	async runMany<T>(requests: LockRequest[], callback: RepositoryOperation<T>, signal?: AbortSignal) {
		return this.runManagedOperation(
			(operationSignal) => this.openManyLease(requests, operationSignal),
			callback,
			signal,
		);
	}

	async shutdown(options: { timeoutMs?: number } = {}) {
		if (this.shutdownPromise) {
			return await this.shutdownPromise;
		}

		this.shuttingDown = true;
		this.shutdownPromise = (async () => {
			const activeOperations = [...this.activeOperations.values()];
			const reason = new Error("Repository mutex is shutting down");

			for (const operation of activeOperations) {
				if (!operation.abortController.signal.aborted) {
					operation.abortController.abort(reason);
				}
			}

			await this.waitForShutdownSettled(activeOperations, options.timeoutMs ?? SHUTDOWN_WAIT_MS);

			for (const operation of activeOperations) {
				operation.release?.();
				operation.cleanup();
			}

			this.releaseOwnedRows();
			this.stopAllHeartbeats();
		})().finally(() => {
			this.shuttingDown = false;
			this.shutdownPromise = null;
		});

		return await this.shutdownPromise;
	}

	isLocked(repositoryId: string) {
		const now = Date.now();

		return db.transaction((tx) => {
			this.cleanupExpired(tx, now);
			return this.getActiveLocks(tx, repositoryId, now).length > 0;
		});
	}

	private createReleaseMany(locks: AcquiredLock[]) {
		const releases = locks.map((lock) => this.createRelease(lock));
		let released = false;

		return () => {
			if (released) return;

			released = true;
			for (const release of releases.toReversed()) {
				release();
			}
		};
	}

	private createRelease(lock: AcquiredLock) {
		this.startHeartbeat("lock", lock.id);
		let released = false;

		return () => {
			if (released) return;

			released = true;
			this.stopHeartbeat(lock.id);
			this.release(lock);
		};
	}

	private release(lock: Pick<AcquiredLock, "id">) {
		const releasedLock = db.transaction((tx) => {
			const row = tx.query.repositoryLocksTable
				.findFirst({ where: { AND: [{ id: { eq: lock.id } }, { ownerId: { eq: this.ownerId } }] } })
				.sync();

			if (!row) return null;

			tx.delete(repositoryLocksTable)
				.where(and(eq(repositoryLocksTable.id, lock.id), eq(repositoryLocksTable.ownerId, this.ownerId)))
				.run();

			return row;
		});

		if (!releasedLock) return;

		const duration = Date.now() - releasedLock.acquiredAt;
		logger.debug(
			`[Mutex] Released ${releasedLock.type} lock for repo ${releasedLock.repositoryId}: ${releasedLock.operation} (held for ${duration}ms)`,
		);
	}

	private startHeartbeat(target: HeartbeatTarget, lockId: string) {
		this.stopHeartbeat(lockId);

		const heartbeat = () => {
			const now = Date.now();
			const values = { heartbeatAt: now, expiresAt: now + LOCK_LEASE_MS };

			try {
				if (target === "lock") {
					db.update(repositoryLocksTable)
						.set(values)
						.where(and(eq(repositoryLocksTable.id, lockId), eq(repositoryLocksTable.ownerId, this.ownerId)))
						.run();
				} else {
					db.update(repositoryLockWaitersTable)
						.set(values)
						.where(
							and(
								eq(repositoryLockWaitersTable.id, lockId),
								eq(repositoryLockWaitersTable.ownerId, this.ownerId),
							),
						)
						.run();
				}
			} catch (error) {
				logger.warn(`[Mutex] Failed to heartbeat ${target} ${lockId}: ${String(error)}`);
			}
		};

		const timer = setInterval(heartbeat, LOCK_HEARTBEAT_MS);
		if (timer && "unref" in timer) {
			timer.unref();
		}

		this.heartbeatTimers.set(lockId, timer);
	}

	private stopHeartbeat(lockId: string) {
		const timer = this.heartbeatTimers.get(lockId);
		if (!timer) {
			return;
		}

		clearInterval(timer);
		this.heartbeatTimers.delete(lockId);
	}
}

export const repoMutex = getRepositoryMutex();
