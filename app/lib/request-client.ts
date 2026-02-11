import type { Config } from "~/client/api-client/client";
import { createClient, createConfig } from "~/client/api-client/client";

export type RequestClient = ReturnType<typeof createClient>;

type RequestClientStore = {
	getStore: () => RequestClient | undefined;
	run: <T>(client: RequestClient, fn: () => T) => T;
};

type AsyncLocalStorageConstructor = new <T>() => {
	getStore: () => T | undefined;
	run: <R>(store: T, callback: () => R) => R;
};

let requestClientStore: RequestClientStore | undefined;

const ASYNC_HOOKS_MODULE = "node:async_hooks";

const loadRequestClientStore = async (): Promise<RequestClientStore | undefined> => {
	if (typeof window !== "undefined") {
		return undefined;
	}

	if (!requestClientStore) {
		const asyncHooksModule = (await import(/* @vite-ignore */ ASYNC_HOOKS_MODULE)) as {
			AsyncLocalStorage: AsyncLocalStorageConstructor;
		};
		requestClientStore = new asyncHooksModule.AsyncLocalStorage<RequestClient>();
	}

	return requestClientStore;
};

export function getRequestClient(): RequestClient {
	const client = requestClientStore?.getStore();

	if (!client) {
		throw new Error("No request client available");
	}

	return client;
}

export async function runWithRequestClient<T>(client: RequestClient, fn: () => T): Promise<T> {
	const store = await loadRequestClientStore();

	if (!store) {
		return fn();
	}

	return store.run(client, fn);
}

export function createRequestClient(config: Config): RequestClient {
	return createClient(createConfig(config));
}
