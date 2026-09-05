export type ApplicationLifecycleStatus = "stopped" | "starting" | "running" | "stopping";

export type ApplicationLifecycleRuntime = {
	lifecycleTail: Promise<void>;
	shutdownPromise: Promise<void> | null;
	status: ApplicationLifecycleStatus;
	invocationGeneration: number;
	completedGeneration: number;
};

export type ProcessWithApplicationLifecycleRuntime = NodeJS.Process & {
	__zerobyteApplicationLifecycleRuntime?: ApplicationLifecycleRuntime;
};

const createApplicationLifecycleRuntime = (): ApplicationLifecycleRuntime => ({
	lifecycleTail: Promise.resolve(),
	shutdownPromise: null,
	status: "stopped",
	invocationGeneration: 0,
	completedGeneration: 0,
});

export const getApplicationLifecycleRuntime = (): ApplicationLifecycleRuntime => {
	const runtimeProcess = process as ProcessWithApplicationLifecycleRuntime;
	const existingRuntime = runtimeProcess.__zerobyteApplicationLifecycleRuntime;
	if (existingRuntime) {
		return existingRuntime;
	}

	const runtime = createApplicationLifecycleRuntime();
	runtimeProcess.__zerobyteApplicationLifecycleRuntime = runtime;
	return runtime;
};

export const enqueueApplicationLifecycleTransition = <Result>(
	transition: (runtime: ApplicationLifecycleRuntime, generation: number) => Promise<Result>,
) => {
	const runtime = getApplicationLifecycleRuntime();
	runtime.invocationGeneration += 1;
	const generation = runtime.invocationGeneration;
	const runTransition = () => transition(runtime, generation);
	const operation = runtime.lifecycleTail.then(runTransition);
	runtime.lifecycleTail = operation.then(
		() => undefined,
		() => undefined,
	);
	return operation;
};
