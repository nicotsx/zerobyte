import { repoMutex } from "~/server/core/repository-mutex";

export const createDeferred = <T = void>() => {
	let resolve: (value: T | PromiseLike<T>) => void = () => {};
	let reject: (reason?: unknown) => void = () => {};
	const promise = new Promise<T>((promiseResolve, promiseReject) => {
		resolve = promiseResolve;
		reject = promiseReject;
	});

	return { promise, resolve, reject };
};

const holdWithRun = async (run: (callback: () => Promise<void>) => Promise<unknown>) => {
	const started = createDeferred();
	const finished = createDeferred();
	const operation = run(async () => {
		started.resolve();
		await finished.promise;
	});
	operation.catch((error) => started.reject(error));

	await started.promise;

	let released = false;
	return async () => {
		if (!released) {
			released = true;
			finished.resolve();
		}

		await operation;
	};
};

export const holdSharedLock = (repositoryId: string, operation: string, signal?: AbortSignal) =>
	holdWithRun((callback) => repoMutex.runShared(repositoryId, operation, callback, signal));

export const holdExclusiveLock = (repositoryId: string, operation: string, signal?: AbortSignal) =>
	holdWithRun((callback) => repoMutex.runExclusive(repositoryId, operation, callback, signal));

export const holdManyLocks = (requests: Parameters<typeof repoMutex.runMany>[0], signal?: AbortSignal) =>
	holdWithRun((callback) => repoMutex.runMany(requests, callback, signal));
