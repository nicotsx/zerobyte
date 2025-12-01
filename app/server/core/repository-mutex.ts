import { logger } from "../utils/logger";

export type LockType = "shared" | "exclusive";

interface LockHolder {
	id: string;
	operation: string;
	acquiredAt: number;
}

interface RepositoryLockState {
	sharedHolders: Map<string, LockHolder>;
	exclusiveHolder: LockHolder | null;
	waitQueue: Array<{
		type: LockType;
		operation: string;
		resolve: (lockId: string) => void;
	}>;
}

class RepositoryMutex {
	private locks = new Map<string, RepositoryLockState>();
	private lockIdCounter = 0;

	private getOrCreateState(repositoryId: string): RepositoryLockState {
		let state = this.locks.get(repositoryId);
		if (!state) {
			state = {
				sharedHolders: new Map(),
				exclusiveHolder: null,
				waitQueue: [],
			};
			this.locks.set(repositoryId, state);
		}
		return state;
	}

	private generateLockId(): string {
		return `lock_${++this.lockIdCounter}_${Date.now()}`;
	}

	private cleanupStateIfEmpty(repositoryId: string): void {
		const state = this.locks.get(repositoryId);
		if (state && state.sharedHolders.size === 0 && !state.exclusiveHolder && state.waitQueue.length === 0) {
			this.locks.delete(repositoryId);
		}
	}

	async acquireShared(repositoryId: string, operation: string): Promise<() => void> {
		const state = this.getOrCreateState(repositoryId);

		const hasExclusiveWaiter = state.waitQueue.some((w) => w.type === "exclusive");
		if (!state.exclusiveHolder && !hasExclusiveWaiter) {
			const lockId = this.generateLockId();
			state.sharedHolders.set(lockId, {
				id: lockId,
				operation,
				acquiredAt: Date.now(),
			});
			return () => this.releaseShared(repositoryId, lockId);
		}

		logger.debug(`[Mutex] Waiting for shared lock on repo ${repositoryId}: ${operation}`);
		const lockId = await new Promise<string>((resolve) => {
			state.waitQueue.push({ type: "shared", operation, resolve });
		});

		return () => this.releaseShared(repositoryId, lockId);
	}

	async acquireExclusive(repositoryId: string, operation: string): Promise<() => void> {
		const state = this.getOrCreateState(repositoryId);

		if (!state.exclusiveHolder && state.sharedHolders.size === 0 && state.waitQueue.length === 0) {
			const lockId = this.generateLockId();
			state.exclusiveHolder = {
				id: lockId,
				operation,
				acquiredAt: Date.now(),
			};
			return () => this.releaseExclusive(repositoryId, lockId);
		}

		logger.debug(
			`[Mutex] Waiting for exclusive lock on repo ${repositoryId}: ${operation} (shared: ${state.sharedHolders.size}, exclusive: ${state.exclusiveHolder ? "yes" : "no"}, queue: ${state.waitQueue.length})`,
		);
		const lockId = await new Promise<string>((resolve) => {
			state.waitQueue.push({ type: "exclusive", operation, resolve });
		});

		logger.debug(`[Mutex] Acquired exclusive lock for repo ${repositoryId}: ${operation} (${lockId})`);
		return () => this.releaseExclusive(repositoryId, lockId);
	}

	private releaseShared(repositoryId: string, lockId: string): void {
		const state = this.locks.get(repositoryId);
		if (!state) {
			return;
		}

		const holder = state.sharedHolders.get(lockId);
		if (!holder) {
			return;
		}

		state.sharedHolders.delete(lockId);
		const duration = Date.now() - holder.acquiredAt;
		logger.debug(`[Mutex] Released shared lock for repo ${repositoryId}: ${holder.operation} (held for ${duration}ms)`);

		this.processWaitQueue(repositoryId);
		this.cleanupStateIfEmpty(repositoryId);
	}

	private releaseExclusive(repositoryId: string, lockId: string): void {
		const state = this.locks.get(repositoryId);
		if (!state) {
			return;
		}

		if (!state.exclusiveHolder || state.exclusiveHolder.id !== lockId) {
			return;
		}

		const duration = Date.now() - state.exclusiveHolder.acquiredAt;
		logger.debug(
			`[Mutex] Released exclusive lock for repo ${repositoryId}: ${state.exclusiveHolder.operation} (held for ${duration}ms)`,
		);
		state.exclusiveHolder = null;

		this.processWaitQueue(repositoryId);
		this.cleanupStateIfEmpty(repositoryId);
	}

	private processWaitQueue(repositoryId: string): void {
		const state = this.locks.get(repositoryId);
		if (!state || state.waitQueue.length === 0) {
			return;
		}

		if (state.exclusiveHolder) {
			return;
		}

		const firstWaiter = state.waitQueue[0];

		if (firstWaiter.type === "exclusive") {
			if (state.sharedHolders.size === 0) {
				state.waitQueue.shift();
				const lockId = this.generateLockId();
				state.exclusiveHolder = {
					id: lockId,
					operation: firstWaiter.operation,
					acquiredAt: Date.now(),
				};
				firstWaiter.resolve(lockId);
			}
		} else {
			while (state.waitQueue.length > 0 && state.waitQueue[0].type === "shared") {
				const waiter = state.waitQueue.shift();
				if (!waiter) break;
				const lockId = this.generateLockId();
				state.sharedHolders.set(lockId, {
					id: lockId,
					operation: waiter.operation,
					acquiredAt: Date.now(),
				});
				waiter.resolve(lockId);
			}
		}
	}

	isLocked(repositoryId: string): boolean {
		const state = this.locks.get(repositoryId);
		if (!state) return false;
		return state.exclusiveHolder !== null || state.sharedHolders.size > 0;
	}
}

export const repoMutex = new RepositoryMutex();
