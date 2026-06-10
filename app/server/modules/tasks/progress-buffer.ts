import { taskStore } from "./tasks.store";
import type { TaskProgress } from "./tasks.schemas";

type TaskProgressBufferOptions = {
	intervalMs?: number;
	onError?: (error: unknown) => void;
};

const DEFAULT_PROGRESS_PERSIST_INTERVAL_MS = 15_000;

export const createTaskProgressBuffer = (taskId: string, options: TaskProgressBufferOptions = {}) => {
	const intervalMs = options.intervalMs ?? DEFAULT_PROGRESS_PERSIST_INTERVAL_MS;
	let latestProgress: TaskProgress | null = null;
	let dirty = false;
	let disposed = false;
	let hasPersistedProgress = false;
	let timer: ReturnType<typeof setTimeout> | null = null;

	const clearTimer = () => {
		if (!timer) return;
		clearTimeout(timer);
		timer = null;
	};

	const persistLatest = () => {
		if (!latestProgress || !dirty || disposed) return;

		try {
			taskStore.updateProgress(taskId, latestProgress);
			dirty = false;
			hasPersistedProgress = true;
		} catch (error) {
			options.onError?.(error);
		}
	};

	const schedulePersist = () => {
		if (disposed || timer) return;

		timer = setTimeout(() => {
			timer = null;
			persistLatest();

			if (dirty) {
				schedulePersist();
			}
		}, intervalMs);
		timer.unref?.();
	};

	return {
		update: (progress: TaskProgress) => {
			if (disposed) return;

			const shouldPersistImmediately = !hasPersistedProgress;
			latestProgress = progress;
			dirty = true;

			if (shouldPersistImmediately) {
				persistLatest();
			}

			schedulePersist();
		},
		flush: () => {
			clearTimer();
			persistLatest();
		},
		dispose: () => {
			disposed = true;
			clearTimer();
		},
	};
};
