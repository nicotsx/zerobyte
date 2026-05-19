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

type RepositoryMutexTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type HeartbeatTarget = "lock" | "waiter";
type QueueAttempt = { status: "acquired"; lock: AcquiredLock } | { status: "waiting" } | { status: "missing" };

const LOCK_LEASE_MS = 30_000;
const LOCK_HEARTBEAT_MS = 5_000;
const LOCK_POLL_MS = 250;

class RepositoryMutex {
	private ownerId = `owner_${Bun.randomUUIDv7()}`;
	private heartbeatTimers = new Map<string, ReturnType<typeof setInterval>>();

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
			this.cleanupExpired(tx, now);

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

	async acquireShared(repositoryId: string, operation: string, signal?: AbortSignal) {
		this.throwIfAborted(signal);

		const request: LockRequest = { repositoryId, type: "shared", operation };
		const releaseLock = this.tryAcquireImmediately(request, signal);
		if (releaseLock) {
			return releaseLock;
		}

		logger.debug(`[Mutex] Waiting for shared lock on repo ${repositoryId}: ${operation}`);
		return await this.waitForQueuedLock(request, signal);
	}

	async acquireExclusive(repositoryId: string, operation: string, signal?: AbortSignal) {
		this.throwIfAborted(signal);

		const request: LockRequest = { repositoryId, type: "exclusive", operation };
		const releaseLock = this.tryAcquireImmediately(request, signal);
		if (releaseLock) {
			logger.debug(`[Mutex] Acquired exclusive lock for repo ${repositoryId}: ${operation}`);
			return releaseLock;
		}

		logger.debug(`[Mutex] Waiting for exclusive lock on repo ${repositoryId}: ${operation}`);
		const queuedReleaseLock = await this.waitForQueuedLock(request, signal);
		logger.debug(`[Mutex] Acquired exclusive lock for repo ${repositoryId}: ${operation}`);
		return queuedReleaseLock;
	}

	async acquireMany(requests: LockRequest[], signal?: AbortSignal) {
		this.throwIfAborted(signal);

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
		while (true) {
			const locks = this.tryAcquireManyRows(sortedRequests);
			if (locks) {
				const releaseLocks = this.createReleaseMany(locks);
				this.releaseIfAborted(releaseLocks, signal);

				return releaseLocks;
			}

			await this.waitForPoll(signal);
		}
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

export const repoMutex = new RepositoryMutex();
